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
  validateExpenseParticipants,
} from "./ledger";
import {
  computeNetBalances,
  optimizeSettlements,
  prepareSettlementTransactions,
} from "./settlement";

/**
 * Create a new expense ledger in a group.
 */
async function createExpenseLedger(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof CreateLedgerSchema>
): Promise<string> {
  try {
    const ledgerId = generateId();
    const ledger = await createLedger(
      args.groupId,
      ledgerId,
      args.ledgerName,
      args.currency || "USDC"
    );

    return `✅ Created ledger "${ledger.name}" (ID: ${ledger.id.slice(0, 8)}...) in group ${args.groupId.slice(0, 8)}...\nCurrency: ${ledger.currency}`;
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

    // Validate participants if provided
    if (args.participantInboxIds && args.participantInboxIds.length === 0) {
      return `Error: Participant list cannot be empty`;
    }

    // Validate weights if provided
    if (args.weights) {
      if (!args.participantInboxIds) {
        return `Error: Cannot specify weights without specifying participants`;
      }
      if (args.weights.length !== args.participantInboxIds.length) {
        return `Error: Weights array must match participants array length`;
      }
    }

    const expense: Expense = {
      id: generateId(),
      ledgerId: args.ledgerId,
      payerInboxId: args.payerInboxId,
      payerAddress: args.payerAddress,
      amount,
      description: args.description,
      participantInboxIds: args.participantInboxIds || [args.payerInboxId],
      weights: args.weights,
      timestamp: Date.now(),
      currency: ledger.currency,
    };

    await addExpenseToStorage(args.groupId, args.ledgerId, expense);

    const participantInfo = args.participantInboxIds
      ? `${args.participantInboxIds.length} people`
      : "payer only";
    const weightInfo = args.weights ? ` (weights: ${args.weights.join(":")})` : "";

    return `✅ Added expense: ${formatCurrency(amount, ledger.currency)} for "${args.description}"\nPaid by: ${args.payerInboxId.slice(0, 8)}...\nSplit among: ${participantInfo}${weightInfo}\nExpense ID: ${expense.id.slice(0, 8)}...`;
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

    return `📊 Balances for ledger "${ledger.name}":\n\n${formatted}`;
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

    // Compute balances
    const balances = computeNetBalances(ledger.expenses);

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

    // Build the multi-transaction response
    const response: MultiTransactionPrepared = {
      type: "MULTI_TRANSACTION_PREPARED",
      description: `Settlement for ledger "${ledger.name}" - ${settlements.length} transfer(s)`,
      settlements: transactions.map(tx => ({
        fromInboxId: tx.settlement.fromInboxId,
        fromAddress: tx.settlement.fromAddress,
        toAddress: tx.settlement.toAddress,
        amount: tx.settlement.amount,
        currency: tx.settlement.currency,
        description: tx.settlement.description,
        call: tx.call,
        metadata: tx.metadata,
      })),
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
      - currency: Optional currency for the ledger (defaults to USDC)
      
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
      - payerInboxId: Inbox ID of who paid (defaults to message sender)
      - payerAddress: Ethereum address of who paid
      - participantInboxIds: Optional array of inbox IDs sharing this expense (defaults to all group members)
      - weights: Optional array of weights for proportional splitting (e.g., [2, 1, 1] for 2:1:1 split)
      
      Use this when users report an expense they paid or someone else paid.
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

