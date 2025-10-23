import { z } from "zod";
import { customActionProvider, EvmWalletProvider } from "@coinbase/agentkit";
import {
  CreateTabSchema,
  ListTabsSchema,
  AddExpenseSchema,
  ListExpensesSchema,
  GetBalanceSchema,
  DeleteExpenseSchema,
  SettleExpensesSchema,
} from "./schemas";
import { MultiTransactionPrepared, Expense } from "./types";
import { generateId, getUSDCDetails, parseAmount, formatCurrency } from "./utils";
import {
  createTab,
  getTab,
  listTabs,
  addExpense as addExpenseToStorage,
  deleteExpense as deleteExpenseFromStorage,
} from "./storage";
import {
  formatExpensesList,
  formatBalances,
  calculateBalances,
} from "./tab";
import {
  computeNetBalances,
  optimizeSettlements,
  prepareSettlementTransactions,
} from "./settlement";
import { getGroupMembers } from "../xmtp/utils";

/**
 * Create a new expense tab in a group.
 */
async function createExpenseTab(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof CreateTabSchema>
): Promise<string> {
  try {
    const tabId = generateId();
    
    // Fetch all group members automatically
    const participants = await getGroupMembers(args.groupId);
    
    if (participants.length === 0) {
      return `Error: No members found in group ${args.groupId}`;
    }

    const tab = await createTab(
      args.groupId,
      tabId,
      args.tabName,
      "USDC",
      participants
    );

    return `✅ Created tab "${tab.name}" (ID: ${tab.id})\nParticipants: ${participants.length} group members\nCurrency: ${tab.currency}`;
  } catch (error) {
    return `Error creating tab: ${error}`;
  }
}

/**
 * List all tabs in a group.
 */
async function listExpenseTabs(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof ListTabsSchema>
): Promise<string> {
  try {
    const tabs = await listTabs(args.groupId);

    if (tabs.length === 0) {
      return `No tabs found in this group. Create one with create_expense_tab!`;
    }

    let output = `📚 Tabs in group ${args.groupId.slice(0, 8)}...:\n\n`;
    for (const tab of tabs) {
      const expenseCount = tab.expenses.length;
      const createdDate = new Date(tab.createdAt).toLocaleDateString();
      output += `• ${tab.name}\n`;
      output += `  ID: ${tab.id.slice(0, 8)}...\n`;
      output += `  Currency: ${tab.currency}\n`;
      output += `  Expenses: ${expenseCount}\n`;
      output += `  Created: ${createdDate}\n\n`;
    }

    return output.trim();
  } catch (error) {
    return `Error listing tabs: ${error}`;
  }
}

/**
 * Add an expense to a tab.
 */
async function addExpense(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof AddExpenseSchema>
): Promise<string> {
  try {
    const tab = await getTab(args.groupId, args.tabId);
    if (!tab) {
      return `Error: Tab ${args.tabId} not found in group ${args.groupId}`;
    }

    // Validate amount
    const amount = parseAmount(args.amount);

    // Get payer information by address
    const normalizedPayerAddress = args.payerAddress.toLowerCase();
    const payer = tab.participants.find(p => p.address === normalizedPayerAddress);
    
    if (!payer) {
      return `Error: Address ${args.payerAddress} is not a participant in this tab`;
    }

    // Determine participants for this expense
    let participantInboxIds: string[];
    
    if (args.participantAddresses && args.participantAddresses.length > 0) {
      // Subset of participants specified by addresses
      const normalizedAddresses = args.participantAddresses.map(addr => addr.toLowerCase());
      
      // Validate all addresses exist in tab participants
      const invalidAddresses = normalizedAddresses.filter(
        addr => !tab.participants.some(p => p.address === addr)
      );
      
      if (invalidAddresses.length > 0) {
        return `Error: The following addresses are not participants in this tab: ${invalidAddresses.join(", ")}`;
      }
      
      // Convert addresses to inboxIds
      participantInboxIds = tab.participants
        .filter(p => normalizedAddresses.includes(p.address))
        .map(p => p.inboxId);
    } else {
      // Default to all tab participants
      participantInboxIds = tab.participants.map(p => p.inboxId);
    }

    if (participantInboxIds.length === 0) {
      return `Error: No valid participants for this expense`;
    }

    const expense: Expense = {
      id: generateId(),
      tabId: args.tabId,
      payerInboxId: payer.inboxId,
      payerAddress: payer.address,
      amount,
      description: args.description,
      participantInboxIds,
      timestamp: Date.now(),
      currency: tab.currency,
    };

    await addExpenseToStorage(args.groupId, args.tabId, expense);

    const participantInfo = args.participantAddresses
      ? `${participantInboxIds.length} people (${args.participantAddresses.map(a => a.slice(0, 6)).join(", ")}...)`
      : `all ${participantInboxIds.length} participants`;

    return `✅ Added expense: ${formatCurrency(amount, tab.currency)} for "${args.description}"\nPaid by: ${payer.address.slice(0, 8)}...\nSplit among: ${participantInfo}\nExpense ID: ${expense.id.slice(0, 8)}...`;
  } catch (error) {
    return `Error adding expense: ${error}`;
  }
}

/**
 * List all expenses in a tab.
 */
async function listExpenses(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof ListExpensesSchema>
): Promise<string> {
  try {
    const tab = await getTab(args.groupId, args.tabId);
    if (!tab) {
      return `Error: Tab ${args.tabId} not found in group ${args.groupId}`;
    }

    const formatted = formatExpensesList(tab.expenses, tab.currency);
    return `📖 Tab: ${tab.name}\n\n${formatted}`;
  } catch (error) {
    return `Error listing expenses: ${error}`;
  }
}

/**
 * Get balances for all participants in a tab.
 */
async function getBalances(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof GetBalanceSchema>
): Promise<string> {
  try {
    const tab = await getTab(args.groupId, args.tabId);
    if (!tab) {
      return `Error: Tab ${args.tabId} not found in group ${args.groupId}`;
    }

    if (tab.expenses.length === 0) {
      return `No expenses in tab "${tab.name}". Nothing to settle!`;
    }

    const balances = calculateBalances(tab.expenses);
    const formatted = formatBalances(balances, tab.currency);

    // Debug info
    let debugInfo = `\n\n🐛 DEBUG:\n  Tab participants: ${tab.participants.length}\n  Expenses: ${tab.expenses.length}`;
    for (let i = 0; i < tab.expenses.length; i++) {
      const exp = tab.expenses[i];
      debugInfo += `\n  Expense ${i + 1}: ${exp.amount} split among ${exp.participantInboxIds.length} people`;
    }

    return `📊 Balances for tab "${tab.name}":\n\n${formatted}${debugInfo}`;
  } catch (error) {
    return `Error calculating balances: ${error}`;
  }
}

/**
 * Delete an expense from a tab.
 */
async function deleteExpense(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof DeleteExpenseSchema>
): Promise<string> {
  try {
    await deleteExpenseFromStorage(args.groupId, args.tabId, args.expenseId);

    return `✅ Deleted expense ${args.expenseId.slice(0, 8)}... from tab`;
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
    const tab = await getTab(args.groupId, args.tabId);
    if (!tab) {
      return `Error: Tab ${args.tabId} not found in group ${args.groupId}`;
    }

    if (tab.expenses.length === 0) {
      return `No expenses in tab "${tab.name}". Nothing to settle!`;
    }

    // Get token address (default to USDC for the network)
    const networkId = process.env.NETWORK_ID || "base-sepolia";
    const tokenDetails = args.tokenAddress
      ? { address: args.tokenAddress as `0x${string}`, decimals: 6 }
      : getUSDCDetails(networkId);

    // Compute balances (pass participants to ensure all addresses are resolved)
    const balances = computeNetBalances(tab.expenses, tab.participants);

    // Check if everyone is settled
    const hasImbalance = balances.some(b => Math.abs(parseFloat(b.netAmount)) > 0.01);
    if (!hasImbalance) {
      return `✅ All settled! Everyone has paid their fair share.`;
    }

    // Optimize settlements
    const settlements = optimizeSettlements(balances, tab.currency);

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
      description: `Settlement for tab "${tab.name}" - ${batchedSettlements.length} payer(s), ${settlements.length} transfer(s)`,
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
      name: "create_expense_tab",
      description: `
      This tool creates a new expense tab in an XMTP group.
      
      It takes the following inputs:
      - groupId: The XMTP group ID where this tab will be created
      - tabName: A human-readable name for the tab (e.g., "Weekend Trip", "Monthly Dinners")
      
      The tab automatically includes all current group members as participants.
      Currency is always USDC.
      
      Use this when users want to start tracking expenses for a specific event or period.
      `,
      schema: CreateTabSchema,
      invoke: createExpenseTab,
    },
    {
      name: "list_expense_tabs",
      description: `
      This tool lists all expense tabs in an XMTP group.
      
      It takes the following inputs:
      - groupId: The XMTP group ID to list tabs for
      
      Use this when users want to see all available tabs in their group.
      `,
      schema: ListTabsSchema,
      invoke: listExpenseTabs,
    },
    {
      name: "add_expense",
      description: `
      This tool adds an expense to an expense tab.
      
      It takes the following inputs:
      - groupId: The XMTP group ID
      - tabId: The tab ID to add the expense to
      - amount: The amount of the expense as a string (e.g., "10.5", "100")
      - description: What the expense was for (e.g., "beer", "dinner", "hotel")
      - payerAddress: Ethereum address of the person who paid for this expense (can be any tab participant)
      - participantAddresses: Optional array of Ethereum addresses for people sharing this expense
      
      The payer can be anyone in the tab, not just the message sender.
      This allows scenarios like "Alice says: Bob paid for dinner" where Alice is the sender but Bob is the payer.
      If participantAddresses is not provided, the expense is split equally among all tab participants.
      If participantAddresses is provided, the expense is split only among those specific people.
      
      Use this when users report an expense (whether they paid or someone else paid).
      `,
      schema: AddExpenseSchema,
      invoke: addExpense,
    },
    {
      name: "list_expenses",
      description: `
      This tool lists all expenses in a tab with a summary.
      
      It takes the following inputs:
      - groupId: The XMTP group ID
      - tabId: The tab ID to list expenses from
      
      Use this when users want to see all expenses that have been recorded.
      `,
      schema: ListExpensesSchema,
      invoke: listExpenses,
    },
    {
      name: "get_balances",
      description: `
      This tool calculates and shows who owes what in a tab.
      
      It takes the following inputs:
      - groupId: The XMTP group ID
      - tabId: The tab ID to calculate balances for
      
      Use this when users want to know the current balance status (who owes whom).
      `,
      schema: GetBalanceSchema,
      invoke: getBalances,
    },
    {
      name: "delete_expense",
      description: `
      This tool deletes an expense from a tab.
      
      It takes the following inputs:
      - groupId: The XMTP group ID
      - tabId: The tab ID containing the expense
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
      - tabId: The tab ID to settle
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

