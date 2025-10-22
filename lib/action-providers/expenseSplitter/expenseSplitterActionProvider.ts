import { z } from "zod";
import { customActionProvider, EvmWalletProvider } from "@coinbase/agentkit";
import {
  CreateLedgerSchema,
  ListLedgersSchema,
  AddExpenseSchema,
  ListExpensesSchema,
  GetBalanceSchema,
  DeleteExpenseSchema,
  SettleExpensesSchema,
} from "./schemas";
import { MultiTransactionPrepared, Expense } from "./types";
import { generateId, getUSDCDetails, parseAmount, formatCurrency } from "./utils";
import {
  createLedger,
  getLedger,
  listLedgers,
  addExpense as addExpenseToStorage,
  deleteExpense as deleteExpenseFromStorage,
} from "./storage";
import {
  formatExpensesList,
  formatBalances,
  calculateBalances,
} from "./ledger";
import {
  computeNetBalances,
  optimizeSettlements,
  prepareSettlementTransactions,
} from "./settlement";
import { getGroupMembers } from "../xmtp/utils";

/**
 * Create a new expense ledger in a group.
 */
async function createExpenseLedger(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof CreateLedgerSchema>
): Promise<string> {
  try {
    const ledgerId = generateId();
    
    // Fetch all group members automatically
    const participants = await getGroupMembers(args.groupId);
    
    if (participants.length === 0) {
      return `Error: No members found in group ${args.groupId}`;
    }

    const ledger = await createLedger(
      args.groupId,
      ledgerId,
      args.ledgerName,
      "USDC",
      participants
    );

    return `✅ Created ledger "${ledger.name}" (ID: ${ledger.id})\nParticipants: ${participants.length} group members\nCurrency: ${ledger.currency}`;
  } catch (error) {
    return `Error creating ledger: ${error}`;
  }
}

/**
 * List all ledgers in a group.
 */
async function listExpenseLedgers(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof ListLedgersSchema>
): Promise<string> {
  try {
    const ledgers = await listLedgers(args.groupId);

    if (ledgers.length === 0) {
      return `No ledgers found in this group. Create one with create_expense_ledger!`;
    }

    let output = `📚 Ledgers in group ${args.groupId.slice(0, 8)}...:\n\n`;
    for (const ledger of ledgers) {
      const expenseCount = ledger.expenses.length;
      const createdDate = new Date(ledger.createdAt).toLocaleDateString();
      output += `• ${ledger.name}\n`;
      output += `  ID: ${ledger.id.slice(0, 8)}...\n`;
      output += `  Currency: ${ledger.currency}\n`;
      output += `  Expenses: ${expenseCount}\n`;
      output += `  Created: ${createdDate}\n\n`;
    }

    return output.trim();
  } catch (error) {
    return `Error listing ledgers: ${error}`;
  }
}

/**
 * Add an expense to a ledger.
 */
async function addExpense(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof AddExpenseSchema>
): Promise<string> {
  try {
    const ledger = await getLedger(args.groupId, args.ledgerId);
    if (!ledger) {
      return `Error: Ledger ${args.ledgerId} not found in group ${args.groupId}`;
    }

    // Validate amount
    const amount = parseAmount(args.amount);

    // Get payer information by address
    const normalizedPayerAddress = args.payerAddress.toLowerCase();
    const payer = ledger.participants.find(p => p.address === normalizedPayerAddress);
    
    if (!payer) {
      return `Error: Address ${args.payerAddress} is not a participant in this ledger`;
    }

    // Determine participants for this expense
    let participantInboxIds: string[];
    
    if (args.participantAddresses && args.participantAddresses.length > 0) {
      // Subset of participants specified by addresses
      const normalizedAddresses = args.participantAddresses.map(addr => addr.toLowerCase());
      
      // Validate all addresses exist in ledger participants
      const invalidAddresses = normalizedAddresses.filter(
        addr => !ledger.participants.some(p => p.address === addr)
      );
      
      if (invalidAddresses.length > 0) {
        return `Error: The following addresses are not participants in this ledger: ${invalidAddresses.join(", ")}`;
      }
      
      // Convert addresses to inboxIds
      participantInboxIds = ledger.participants
        .filter(p => normalizedAddresses.includes(p.address))
        .map(p => p.inboxId);
    } else {
      // Default to all ledger participants
      participantInboxIds = ledger.participants.map(p => p.inboxId);
    }

    if (participantInboxIds.length === 0) {
      return `Error: No valid participants for this expense`;
    }

    const expense: Expense = {
      id: generateId(),
      ledgerId: args.ledgerId,
      payerInboxId: payer.inboxId,
      payerAddress: payer.address,
      amount,
      description: args.description,
      participantInboxIds,
      timestamp: Date.now(),
      currency: ledger.currency,
    };

    await addExpenseToStorage(args.groupId, args.ledgerId, expense);

    const participantInfo = args.participantAddresses
      ? `${participantInboxIds.length} people (${args.participantAddresses.map(a => a.slice(0, 6)).join(", ")}...)`
      : `all ${participantInboxIds.length} participants`;

    return `✅ Added expense: ${formatCurrency(amount, ledger.currency)} for "${args.description}"\nPaid by: ${payer.address.slice(0, 8)}...\nSplit among: ${participantInfo}\nExpense ID: ${expense.id.slice(0, 8)}...`;
  } catch (error) {
    return `Error adding expense: ${error}`;
  }
}

/**
 * List all expenses in a ledger.
 */
async function listExpenses(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof ListExpensesSchema>
): Promise<string> {
  try {
    const ledger = await getLedger(args.groupId, args.ledgerId);
    if (!ledger) {
      return `Error: Ledger ${args.ledgerId} not found in group ${args.groupId}`;
    }

    const formatted = formatExpensesList(ledger.expenses, ledger.currency);
    return `📖 Ledger: ${ledger.name}\n\n${formatted}`;
  } catch (error) {
    return `Error listing expenses: ${error}`;
  }
}

/**
 * Get balances for all participants in a ledger.
 */
async function getBalances(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof GetBalanceSchema>
): Promise<string> {
  try {
    const ledger = await getLedger(args.groupId, args.ledgerId);
    if (!ledger) {
      return `Error: Ledger ${args.ledgerId} not found in group ${args.groupId}`;
    }

    if (ledger.expenses.length === 0) {
      return `No expenses in ledger "${ledger.name}". Nothing to settle!`;
    }

    const balances = calculateBalances(ledger.expenses);
    const formatted = formatBalances(balances, ledger.currency);

    // Debug info
    let debugInfo = `\n\n🐛 DEBUG:\n  Ledger participants: ${ledger.participants.length}\n  Expenses: ${ledger.expenses.length}`;
    for (let i = 0; i < ledger.expenses.length; i++) {
      const exp = ledger.expenses[i];
      debugInfo += `\n  Expense ${i + 1}: ${exp.amount} split among ${exp.participantInboxIds.length} people`;
    }

    return `📊 Balances for ledger "${ledger.name}":\n\n${formatted}${debugInfo}`;
  } catch (error) {
    return `Error calculating balances: ${error}`;
  }
}

/**
 * Delete an expense from a ledger.
 */
async function deleteExpense(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof DeleteExpenseSchema>
): Promise<string> {
  try {
    await deleteExpenseFromStorage(args.groupId, args.ledgerId, args.expenseId);

    return `✅ Deleted expense ${args.expenseId.slice(0, 8)}... from ledger`;
  } catch (error) {
    return `Error deleting expense: ${error}`;
  }
}

/**
 * Settle expenses by computing optimal transfers and preparing transactions.
 */
async function settleExpenses(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof SettleExpensesSchema>
): Promise<string> {
  try {
    const ledger = await getLedger(args.groupId, args.ledgerId);
    if (!ledger) {
      return `Error: Ledger ${args.ledgerId} not found in group ${args.groupId}`;
    }

    if (ledger.expenses.length === 0) {
      return `No expenses in ledger "${ledger.name}". Nothing to settle!`;
    }

    // Get token address (default to USDC for the network)
    const networkId = process.env.NETWORK_ID || "base-sepolia";
    const tokenDetails = args.tokenAddress
      ? { address: args.tokenAddress as `0x${string}`, decimals: 6 }
      : getUSDCDetails(networkId);

    // Compute balances (pass participants to ensure all addresses are resolved)
    const balances = computeNetBalances(ledger.expenses, ledger.participants);

    // Check if everyone is settled
    const hasImbalance = balances.some(b => Math.abs(parseFloat(b.netAmount)) > 0.01);
    if (!hasImbalance) {
      return `✅ All settled! Everyone has paid their fair share.`;
    }

    // Optimize settlements
    const settlements = optimizeSettlements(balances, ledger.currency);

    if (settlements.length === 0) {
      return `✅ All settled! Everyone has paid their fair share.`;
    }

    // Prepare transactions
    const transactions = prepareSettlementTransactions(
      settlements,
      tokenDetails.address,
      tokenDetails.decimals
    );

    // Group transactions by sender (fromInboxId) to batch calls
    const settlementsByPayer = new Map<string, typeof transactions>();
    for (const tx of transactions) {
      const existing = settlementsByPayer.get(tx.settlement.fromInboxId);
      if (existing) {
        existing.push(tx);
      } else {
        settlementsByPayer.set(tx.settlement.fromInboxId, [tx]);
      }
    }

    // Build the multi-transaction response with batched calls per payer
    const batchedSettlements = Array.from(settlementsByPayer.values()).map(txs => {
      const firstTx = txs[0];
      const totalAmount = txs.reduce((sum, tx) => sum + parseFloat(tx.settlement.amount), 0);
      
      return {
        fromInboxId: firstTx.settlement.fromInboxId,
        fromAddress: firstTx.settlement.fromAddress,
        currency: firstTx.settlement.currency,
        description: txs.length === 1
          ? firstTx.settlement.description
          : `Settlement: ${txs.length} payments totaling ${formatCurrency(totalAmount.toString(), firstTx.settlement.currency)}`,
        calls: txs.map(tx => tx.call),
        metadata: txs.map(tx => ({
          ...tx.metadata,
          description: tx.settlement.description, // Preserve individual description
        })),
      };
    });

    const response: MultiTransactionPrepared = {
      type: "MULTI_TRANSACTION_PREPARED",
      description: `Settlement for ledger "${ledger.name}" - ${batchedSettlements.length} payer(s), ${settlements.length} transfer(s)`,
      settlements: batchedSettlements,
    };

    // Return JSON that will be detected by the chatbot
    return JSON.stringify(response);
  } catch (error) {
    return `Error settling expenses: ${error}`;
  }
}

/**
 * Factory function to create expense splitter action provider.
 * Returns a single action provider with all expense splitting actions.
 */
export const expenseSplitterActionProvider = () => {
  const provider = customActionProvider<EvmWalletProvider>([
    {
      name: "create_expense_ledger",
      description: `
      This tool creates a new expense ledger in an XMTP group.
      
      It takes the following inputs:
      - groupId: The XMTP group ID where this ledger will be created
      - ledgerName: A human-readable name for the ledger (e.g., "Weekend Trip", "Monthly Dinners")
      
      The ledger automatically includes all current group members as participants.
      Currency is always USDC.
      
      Use this when users want to start tracking expenses for a specific event or period.
      `,
      schema: CreateLedgerSchema,
      invoke: createExpenseLedger,
    },
    {
      name: "list_expense_ledgers",
      description: `
      This tool lists all expense ledgers in an XMTP group.
      
      It takes the following inputs:
      - groupId: The XMTP group ID to list ledgers for
      
      Use this when users want to see all available ledgers in their group.
      `,
      schema: ListLedgersSchema,
      invoke: listExpenseLedgers,
    },
    {
      name: "add_expense",
      description: `
      This tool adds an expense to an expense ledger.
      
      It takes the following inputs:
      - groupId: The XMTP group ID
      - ledgerId: The ledger ID to add the expense to
      - amount: The amount of the expense as a string (e.g., "10.5", "100")
      - description: What the expense was for (e.g., "beer", "dinner", "hotel")
      - payerAddress: Ethereum address of the person who paid for this expense (can be any ledger participant)
      - participantAddresses: Optional array of Ethereum addresses for people sharing this expense
      
      The payer can be anyone in the ledger, not just the message sender.
      This allows scenarios like "Alice says: Bob paid for dinner" where Alice is the sender but Bob is the payer.
      If participantAddresses is not provided, the expense is split equally among all ledger participants.
      If participantAddresses is provided, the expense is split only among those specific people.
      
      Use this when users report an expense (whether they paid or someone else paid).
      `,
      schema: AddExpenseSchema,
      invoke: addExpense,
    },
    {
      name: "list_expenses",
      description: `
      This tool lists all expenses in a ledger with a summary.
      
      It takes the following inputs:
      - groupId: The XMTP group ID
      - ledgerId: The ledger ID to list expenses from
      
      Use this when users want to see all expenses that have been recorded.
      `,
      schema: ListExpensesSchema,
      invoke: listExpenses,
    },
    {
      name: "get_balances",
      description: `
      This tool calculates and shows who owes what in a ledger.
      
      It takes the following inputs:
      - groupId: The XMTP group ID
      - ledgerId: The ledger ID to calculate balances for
      
      Use this when users want to know the current balance status (who owes whom).
      `,
      schema: GetBalanceSchema,
      invoke: getBalances,
    },
    {
      name: "delete_expense",
      description: `
      This tool deletes an expense from a ledger.
      
      It takes the following inputs:
      - groupId: The XMTP group ID
      - ledgerId: The ledger ID containing the expense
      - expenseId: The ID of the expense to delete
      
      Use this when users want to correct a mistake by removing an expense.
      `,
      schema: DeleteExpenseSchema,
      invoke: deleteExpense,
    },
    {
      name: "settle_expenses",
      description: `
      This tool computes optimal settlements and prepares USDC transfer transactions.
      
      It takes the following inputs:
      - groupId: The XMTP group ID
      - ledgerId: The ledger ID to settle
      - tokenAddress: Optional token contract address (defaults to USDC for current network)
      
      This action:
      1. Calculates net balances for all participants
      2. Computes the minimum number of transfers needed to settle
      3. Prepares USDC transfer transactions for each payer
      4. Returns transaction data that the chatbot will use to send to each payer
      
      Use this when users are ready to settle up and transfer funds.
      `,
      schema: SettleExpensesSchema,
      invoke: settleExpenses,
    },
  ]);

  return [provider];
};

