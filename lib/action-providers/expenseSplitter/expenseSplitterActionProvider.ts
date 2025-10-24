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
import { Expense } from "./types";
import { generateId, parseAmount, formatCurrency } from "./utils";
import {
  createTab,
  getTab,
  listTabs,
  addExpense as addExpenseToStorage,
  deleteExpense as deleteExpenseFromStorage,
  updateTab,
} from "./storage";
import {
  calculateTotalExpenses,
  calculateDetailedBalances,
} from "./tab";
import { getGroupMembers, getXmtpAgent } from "../xmtp/utils";
import { resolveIdentifierToAddress, resolveAddressToDisplayName } from "../../identity-resolver";
import { prepareTabSettlement } from "./utils";

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
    const allMembers = await getGroupMembers(args.groupId);
    
    // Exclude the agent from default participants
    const agent = await getXmtpAgent();
    const agentAddress = agent.address?.toLowerCase();
    const participants = agentAddress 
      ? allMembers.filter(member => member.address !== agentAddress)
      : allMembers;
    
    if (participants.length === 0) {
      return JSON.stringify({
        success: false,
        message: `No members found in group ${args.groupId} (excluding agent)`,
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
        status: tab.status,
      };
    });

    const tabsList = tabsData.map(tab => 
      `- ${tab.name} with ${tab.totalAmount} ${tab.currency} expenses`
    ).join('\n');

    const message = tabs.length > 0 
      ? `Found ${tabs.length} tab(s) in this group:\n\n${tabsList}`
      : 'No tabs found in this group';

    return JSON.stringify({
      success: true,
      data: { tabs: tabsData },
      message,
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

    // Check tab status
    if (tab.status === "settlement_proposed") {
      // Allow, but reset to open
      tab.status = "open";
      tab.currentSettlement = undefined;
      await updateTab(args.groupId, args.tabId, tab);
    } else if (tab.status === "settling" || tab.status === "settled") {
      return JSON.stringify({
        success: false,
        message: `Cannot add expenses - tab is ${tab.status}. Please create a new tab.`,
      });
    }

    // Validate amount
    const amount = parseAmount(args.amount);

    // Resolve payer identifier to address
    let payerAddress: string;
    try {
      payerAddress = await resolveIdentifierToAddress(args.payerAddress);
    } catch (error) {
      return JSON.stringify({
        success: false,
        message: `Could not resolve payer identifier "${args.payerAddress}": ${error}`,
      });
    }

    // Get payer information by resolved address
    const normalizedPayerAddress = payerAddress.toLowerCase();
    const payer = tab.participants.find(p => p.address === normalizedPayerAddress);
    
    if (!payer) {
      const payerDisplayName = await resolveAddressToDisplayName(payerAddress);
      return JSON.stringify({
        success: false,
        message: `${payerDisplayName} is not a participant in this tab`,
      });
    }

    // Determine participants for this expense
    let participantInboxIds = tab.participants.map(p => p.inboxId);

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

    // Get participant display names for response
    const expenseParticipantAddresses = tab.participants
      .filter(p => participantInboxIds.includes(p.inboxId))
      .map(p => p.address);
    
    const participantDisplayNames = await Promise.all(
      expenseParticipantAddresses.map(addr => resolveAddressToDisplayName(addr))
    );
    
    const payerDisplayName = await resolveAddressToDisplayName(payer.address);

    return JSON.stringify({
      success: true,
      data: {
        expenseId: expense.id,
        amount,
        description: args.description,
        payerDisplayName,
        participantDisplayNames,
      },
      message: `Added expense: ${formatCurrency(amount, tab.currency)} for "${args.description}" paid by ${payerDisplayName} ✅`,
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

    // Format expenses with display names
    const expenses = await Promise.all(tab.expenses.map(async (expense) => {
      // Get participant addresses for this expense
      const participantAddresses = tab.participants
        .filter(p => expense.participantInboxIds.includes(p.inboxId))
        .map(p => p.address);
      
      // Resolve to display names
      const payerDisplayName = await resolveAddressToDisplayName(expense.payerAddress);
      const participantDisplayNames = await Promise.all(
        participantAddresses.map(addr => resolveAddressToDisplayName(addr))
      );
      
      return {
        id: expense.id,
        amount: expense.amount,
        description: expense.description,
        payer: payerDisplayName,
        participants: participantDisplayNames,
        timestamp: expense.timestamp,
      };
    }));

    // Calculate detailed balances with display names
    const balances = calculateDetailedBalances(tab.expenses, tab.participants);
    const balancesWithDisplayNames = await Promise.all(balances.map(async (balance) => {
      const displayName = await resolveAddressToDisplayName(balance.address);
      return {
        displayName,
        totalPaid: balance.totalPaid,
        netSettlement: balance.netSettlement,
        status: balance.status,
      };
    }));

    // Get participant display names
    const participantDisplayNames = await Promise.all(
      tab.participants.map(p => resolveAddressToDisplayName(p.address))
    );

    // Format settlement info if present
    let settlementInfo;
    if (tab.currentSettlement) {
      const confirmedCount = tab.currentSettlement.transactions.filter(t => t.status === "confirmed").length;
      const totalCount = tab.currentSettlement.transactions.length;
      settlementInfo = {
        id: tab.currentSettlement.id,
        status: tab.currentSettlement.status,
        createdAt: tab.currentSettlement.createdAt,
        transactionsConfirmed: confirmedCount,
        transactionsTotal: totalCount,
      };
    }

    // Build formatted message
    let message = `📝 ${tab.name}\n\n`;
    message += `Status: ${tab.status}\n`;
    message += `Participants: ${tab.participants.length}\n`;
    message += `Total: ${formatCurrency(totalExpenses, tab.currency)}\n\n`;

    // Show expenses
    if (expenses.length > 0) {
      message += `💰 Expenses (${tab.currency}):\n`;
      
      // Group expenses by payer
      const expensesByPayer = new Map<string, typeof expenses>();
      for (const expense of expenses) {
        const payer = expense.payer;
        if (!expensesByPayer.has(payer)) {
          expensesByPayer.set(payer, []);
        }
        expensesByPayer.get(payer)!.push(expense);
      }

      // Display expenses grouped by payer
      for (const [payerDisplayName, payerExpenses] of expensesByPayer) {
        message += `- ${payerDisplayName}:\n`;
        for (const expense of payerExpenses) {
          message += `  • ${formatCurrency(expense.amount, "")}for ${expense.description}\n`;
        }
        message += `\n`;
      }

      // Show balances
      message += `💸 Settlement (${tab.currency}):\n`;
      
      // Sort balances: owed (positive) first, then settled (zero), then owes (negative)
      const sortedBalances = balancesWithDisplayNames.sort((a, b) => {
        const aValue = parseFloat(a.netSettlement);
        const bValue = parseFloat(b.netSettlement);
        return bValue - aValue; // Descending order
      });

      for (const balance of sortedBalances) {
        const amount = parseFloat(balance.netSettlement);
        
        if (amount > 0) {
          // Owed to this person
          message += `- ${balance.displayName}:\n`;
          message += `   +${formatCurrency(balance.netSettlement, "")}\n`;
        } else if (amount < 0) {
          // This person owes
          const absAmount = (amount * -1).toString();
          message += `- ${balance.displayName}:\n`;
          message += `   -${formatCurrency(absAmount, "")}\n`;
        } else {
          // Settled
          message += `- ${balance.displayName}:\n`;
          message += `   ${formatCurrency("0", "")}\n`;
        }
      }
    } else {
      message += `No expenses yet`;
    }

    return JSON.stringify({
      success: true,
      data: {
        tab: {
          id: tab.id,
          name: tab.name,
          currency: tab.currency,
          participants: participantDisplayNames,
          createdAt: tab.createdAt,
          status: tab.status,
        },
        expenses,
        totalExpenses,
        balances: balancesWithDisplayNames,
        settlement: settlementInfo,
      },
      message,
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
      message: `Expense deleted ✅`,
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
    // prepareTabSettlement now includes the formatted message
    return await prepareTabSettlement(args.groupId, args.tabId, args.tokenAddress);
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
      This tool creates a new expense tab for a group.
      Use this when users want to start tracking expenses for a specific event or period.
            
      The tab includes all current group members as participants by default.
      Currency is always USDC.     
      
      Output message to user:
      - Simply report the 'message' field from the JSON response as is
      `,
      schema: CreateTabSchema,
      invoke: createExpenseTab,
    },
    {
      name: "list_expense_tabs",
      description: `
      This tool lists all expense tabs in an XMTP group.
      Use this when users want to see all available tabs in their group.

      Output message to user:
      - Simply report the 'message' field from the JSON response as is
      `,
      schema: ListTabsSchema,
      invoke: listExpenseTabs,
    },
    {
      name: "add_expense",
      description: `
      This tool adds an expense to an expense tab.
      Use this when users report an expense.
      
      The payer can be anyone in the tab, not just the message sender.
      This allows scenarios like "Alice says: Bob paid for dinner" where Alice is the sender but Bob is the payer.
      If participantAddresses is not provided, the expense is split equally among all tab participants.
      If participantAddresses is provided, the expense is split only among those specific people.
      `,
      schema: AddExpenseSchema,
      invoke: addExpense,
    },
    {
      name: "get_tab_info",
      description: `
      This tool gets comprehensive information about a tab including all expenses and current balances.
      Use this when users want to see expenses, check balances, or get a complete overview of a tab.

      Output message to user:
      - Simply report the 'message' field from the JSON response as is
      `,
      schema: GetTabInfoSchema,
      invoke: getTabInfo,
    },
    {
      name: "delete_expense",
      description: `
      This tool deletes an expense from a tab.
      Use this when users want to correct a mistake by removing an expense.

      Output message to user:
      - Simply report the 'message' field from the JSON response as is
      `,
      schema: DeleteExpenseSchema,
      invoke: deleteExpense,
    },
    {
      name: "settle_expenses",
      description: `
      This tool computes optimal settlements and prepares USDC transfer transactions.
      Use this when users are ready to settle up and transfer funds.

      This action:
      1. Calculates net balances for all participants
      2. Computes the minimum number of transfers needed to settle
      3. Prepares USDC transfer transactions for each payer
      4. Returns transaction data that will be send to each payer to approve in their own wallet  
      
      Output message to user:
      - Simply report the 'message' field from the JSON response as is
      `,
      schema: SettleExpensesSchema,
      invoke: settleExpenses,
    },
  ]);

  return [provider];
};

