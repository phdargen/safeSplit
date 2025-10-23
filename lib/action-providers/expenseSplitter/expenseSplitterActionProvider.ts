import { z } from "zod";
import { customActionProvider, EvmWalletProvider } from "@coinbase/agentkit";
import {
  CreateTabSchema,
  ListTabsSchema,
  AddExpenseSchema,
  GetTabInfoSchema,
  DeleteExpenseSchema,
  SettleExpensesSchema,
} from "./schemas";
import { MultiTransactionPrepared, Expense } from "./types";
import { generateId, getUSDCDetails, parseAmount, formatCurrency, addAmounts } from "./utils";
import {
  createTab,
  getTab,
  listTabs,
  addExpense as addExpenseToStorage,
  deleteExpense as deleteExpenseFromStorage,
} from "./storage";
import {
  calculateBalances,
  calculateTotalExpenses,
  calculateDetailedBalances,
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
      return JSON.stringify({
        success: false,
        message: `No members found in group ${args.groupId}`,
      });
    }

    const tab = await createTab(
      args.groupId,
      tabId,
      args.tabName,
      "USDC",
      participants
    );

    return JSON.stringify({
      success: true,
      data: {
        tabId: tab.id,
        name: tab.name,
        participantAddresses: participants.map(p => p.address),
        currency: tab.currency,
      },
      message: `Created tab "${tab.name}" with ${participants.length} participants`,
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      message: `Error creating tab: ${error}`,
    });
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
      return JSON.stringify({
        success: true,
        data: { tabs: [] },
        message: "No tabs found in this group",
      });
    }

    const tabsData = tabs.map((tab) => {
      const totalAmount = calculateTotalExpenses(tab.expenses);
      return {
        id: tab.id,
        name: tab.name,
        currency: tab.currency,
        expenseCount: tab.expenses.length,
        totalAmount,
        participantAddresses: tab.participants.map(p => p.address),
        createdAt: tab.createdAt,
      };
    });

    return JSON.stringify({
      success: true,
      data: { tabs: tabsData },
      message: `Found ${tabs.length} tab(s) in this group`,
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      message: `Error listing tabs: ${error}`,
    });
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
      return JSON.stringify({
        success: false,
        message: `Tab ${args.tabId} not found in group ${args.groupId}`,
      });
    }

    // Validate amount
    const amount = parseAmount(args.amount);

    // Get payer information by address
    const normalizedPayerAddress = args.payerAddress.toLowerCase();
    const payer = tab.participants.find(p => p.address === normalizedPayerAddress);
    
    if (!payer) {
      return JSON.stringify({
        success: false,
        message: `Address ${args.payerAddress} is not a participant in this tab`,
      });
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
        return JSON.stringify({
          success: false,
          message: `The following addresses are not participants in this tab: ${invalidAddresses.join(", ")}`,
        });
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
      return JSON.stringify({
        success: false,
        message: "No valid participants for this expense",
      });
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

    // Get participant addresses for this expense
    const expenseParticipantAddresses = tab.participants
      .filter(p => participantInboxIds.includes(p.inboxId))
      .map(p => p.address);

    return JSON.stringify({
      success: true,
      data: {
        expenseId: expense.id,
        amount,
        description: args.description,
        payerAddress: payer.address,
        participantAddresses: expenseParticipantAddresses,
      },
      message: `Added expense: ${formatCurrency(amount, tab.currency)} for "${args.description}"`,
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      message: `Error adding expense: ${error}`,
    });
  }
}

/**
 * Get comprehensive tab information including expenses and balances.
 */
async function getTabInfo(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof GetTabInfoSchema>
): Promise<string> {
  try {
    const tab = await getTab(args.groupId, args.tabId);
    if (!tab) {
      return JSON.stringify({
        success: false,
        message: `Tab ${args.tabId} not found in group ${args.groupId}`,
      });
    }

    // Calculate total expenses
    const totalExpenses = calculateTotalExpenses(tab.expenses);

    // Format expenses
    const expenses = tab.expenses.map((expense) => {
      // Get participant addresses for this expense
      const participantAddresses = tab.participants
        .filter(p => expense.participantInboxIds.includes(p.inboxId))
        .map(p => p.address);
      
      return {
        id: expense.id,
        amount: expense.amount,
        description: expense.description,
        payerAddress: expense.payerAddress,
        participantAddresses,
        timestamp: expense.timestamp,
      };
    });

    // Calculate detailed balances
    const balances = calculateDetailedBalances(tab.expenses, tab.participants);

    return JSON.stringify({
      success: true,
      data: {
        tab: {
          id: tab.id,
          name: tab.name,
          currency: tab.currency,
          participantAddresses: tab.participants.map(p => p.address),
          createdAt: tab.createdAt,
        },
        expenses,
        totalExpenses,
        balances,
      },
      message: `Tab "${tab.name}" has ${expenses.length} expense(s)`,
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      message: `Error getting tab info: ${error}`,
    });
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

    return JSON.stringify({
      success: true,
      data: { expenseId: args.expenseId },
      message: `Deleted expense ${args.expenseId}`,
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      message: `Error deleting expense: ${error}`,
    });
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
    return JSON.stringify({
      success: false,
      message: `Error settling expenses: ${error}`,
    });
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
      
      The tab includes all current group members as participants by default.
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
      name: "get_tab_info",
      description: `
      This tool gets comprehensive information about a tab including all expenses and current balances.
      
      It takes the following inputs:
      - groupId: The XMTP group ID
      - tabId: The tab ID to get information for
      
      Returns:
      - Tab details (name, currency, creation date)
      - List of all expenses with amounts, descriptions, payers, and participants
      - Total expenses amount
      - Detailed balances for each participant showing:
        * Total amount they paid out
        * Net settlement amount (positive = they should receive, negative = they should pay)
        * Status (owes/owed/settled)
      
      Use this when users want to see expenses, check balances, or get a complete overview of a tab.
      `,
      schema: GetTabInfoSchema,
      invoke: getTabInfo,
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

