/**
 * Expense management inline actions menu.
 * Provides button-based UI for managing expense tabs in XMTP groups.
 */
import type { MessageContext } from "@xmtp/agent-sdk";
import { ActionBuilder, registerAction } from "./inline-actions";
import {
  listTabs,
  getTab,
  createTab,
} from "../../lib/action-providers/expenseSplitter/storage";
import {
  calculateTotalExpenses,
  calculateDetailedBalances,
} from "../../lib/action-providers/expenseSplitter/tab";
import { getGroupInfo, getGroupMembers, getXmtpAgent } from "../../lib/action-providers/xmtp/utils";
import { resolveAddressToDisplayName } from "../../lib/identity-resolver";
import { formatCurrency, generateId } from "../../lib/action-providers/expenseSplitter/utils";
import { prepareTabSettlement } from "../../lib/action-providers/expenseSplitter/utils";
import { sendMultipleTransactions } from "../../lib/transaction-handler";

// Predefined tab name templates
const TAB_TEMPLATES = [
  { id: "trip", name: "Trip" },
  { id: "dinner", name: "Dinner" },
  { id: "party", name: "Party" },
  { id: "gift", name: "Gift" },
];

/**
 * Show the main info menu with primary actions.
 */
export async function showMainMenu(ctx: MessageContext): Promise<void> {
  await ActionBuilder.create("info-main-menu", "What can Capy do for you?")
    .add("create-poll", "🗳️ Create Poll")
    .add("view-tabs", "📋 View Tabs")
    .add("create-tab", "➕ Create Tab")
    .add("group-info", "👥 Group Info")
    .send(ctx);
}

/**
 * Show the list of existing tabs as buttons.
 * If only one tab exists, go directly to its details.
 */
async function showTabsList(ctx: MessageContext, groupId: string): Promise<void> {
  try {
    const tabs = await listTabs(groupId);

    if (tabs.length === 0) {
      await ActionBuilder.create("no-tabs", "No tabs yet!")
        .add("create-tab", "➕ Create Tab")
        .send(ctx);
      return;
    }

    // If only one tab, go directly to its details
    if (tabs.length === 1) {
      await showTabDetails(ctx, groupId, tabs[0].id);
      return;
    }

    const builder = ActionBuilder.create("tabs-list", "Select a tab:");

    // Register and add actions for each tab
    for (const tab of tabs) {
      const actionId = `view-tab-${tab.id}`;
      
      // Register handler to go directly to tab details
      registerAction(actionId, async (ctx) => {
        await showTabDetails(ctx, groupId, tab.id);
      });

      // Calculate total for display
      const total = calculateTotalExpenses(tab.expenses);
      const displayTotal = parseFloat(total) > 0 ? ` (${formatCurrency(total, tab.currency)})` : "";
      
      builder.add(actionId, `🗂️ ${tab.name}${displayTotal}`);
    }

    await builder.send(ctx);
  } catch (error) {
    console.error("Error showing tabs list:", error);
    await ctx.sendText(`Error loading tabs: ${error instanceof Error ? error.message : String(error)}`);
  }
}


/**
 * Show detailed tab information including expenses and balances.
 */
async function showTabDetails(ctx: MessageContext, groupId: string, tabId: string): Promise<void> {
  try {
    const tab = await getTab(groupId, tabId);
    if (!tab) {
      await ctx.sendText("Tab not found");
      return;
    }

    // Calculate total expenses
    const totalExpenses = calculateTotalExpenses(tab.expenses);

    // Build message
    let message = `📝 ${tab.name}\n\n`;
    message += `Status: ${tab.status}\n`;
    message += `Participants: ${tab.participants.length}\n`;
    message += `Total: ${formatCurrency(totalExpenses, tab.currency)}\n\n`;

    // Show expenses
    if (tab.expenses.length > 0) {
      message += `💰 Expenses (${tab.currency}):\n`;
      
      // Group expenses by payer
      const expensesByPayer = new Map<string, typeof tab.expenses>();
      for (const expense of tab.expenses) { 
        const payer = expense.payerAddress;
        if (!expensesByPayer.has(payer)) {
          expensesByPayer.set(payer, []);
        }
        expensesByPayer.get(payer)!.push(expense);
      }

      // Display expenses grouped by payer
      for (const [payerAddress, expenses] of expensesByPayer) {
        const payerDisplayName = await resolveAddressToDisplayName(payerAddress);
        message += `- ${payerDisplayName}:\n`;
        for (const expense of expenses) {
          message += `  • ${formatCurrency(expense.amount,"")}for ${expense.description}\n`;
        }
        message += `\n`;
      }

      // Calculate and show balances
      const balances = calculateDetailedBalances(tab.expenses, tab.participants);
      
      message += `💸 Settlement (${tab.currency}):\n`;
      
      // Sort balances: owed (positive) first, then settled (zero), then owes (negative)
      const sortedBalances = balances.sort((a, b) => {
        const aValue = parseFloat(a.netSettlement);
        const bValue = parseFloat(b.netSettlement);
        return bValue - aValue; // Descending order
      });

      for (const balance of sortedBalances) {
        const displayName = await resolveAddressToDisplayName(balance.address);
        const amount = parseFloat(balance.netSettlement);
        
        if (amount > 0) {
          // Owed to this person
          message += `- ${displayName}:\n`;
          message += `   +${formatCurrency(balance.netSettlement,"")}\n`;
        } else if (amount < 0) {
          // This person owes
          const absAmount = (amount * -1).toString();
          message += `- ${displayName}:\n`;
          message += `   -${formatCurrency(absAmount,"")}\n`;
        } else {
          // Settled
          message += `- ${displayName}:\n`;
          message += `   ${formatCurrency("0","")}\n`;
        }
      }
      message += `\n`;
    } else {
      message += `No expenses yet`;
    }

    // Build action builder
    const builder = ActionBuilder.create(`tab-details-${tabId}`, message);

    // Only show settle button if there are expenses
    if (tab.expenses.length > 0) {
      const settleActionId = `settle-tab-${tabId}`;
      registerAction(settleActionId, async (ctx) => {
        await initiateSettlement(ctx, groupId, tabId);
      });
      builder.add(settleActionId, "🤝 Settle Tab");
    }

    // Add expense button (always shown)
    const addExpenseActionId = `add-expense-${tabId}`;
    registerAction(addExpenseActionId, async (ctx) => {
      await ctx.sendText(
        'To add an expense simply tag me (@capy) in a message like "I paid 100 USD for dinner".'
      );
    });
    builder.add(addExpenseActionId, "➕ Add Expense");

    await builder.send(ctx);
  } catch (error) {
    console.error("Error showing tab details:", error);
    await ctx.sendText(`Error loading tab details: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Initiate settlement for a tab by calling the shared settlement utility.
 */
async function initiateSettlement(ctx: MessageContext, groupId: string, tabId: string): Promise<void> {
  try {
    // Use the shared settlement preparation utility
    const result = await prepareTabSettlement(groupId, tabId);

    // Check if result is an error message or success message (not JSON)
    if (!result.startsWith('{')) {
      await ctx.sendText(result);
      return;
    }

    // Parse the result to check if it's a MultiTransactionPrepared or an error
    const parsed = JSON.parse(result);
    
    // Check for error response
    if (parsed.success === false) {
      await ctx.sendText(parsed.message);
      return;
    }

    // Check if it's a MultiTransactionPrepared
    if (parsed.type === "MULTI_TRANSACTION_PREPARED") {
      await sendMultipleTransactions(ctx, parsed, parsed.message || "");
    } else {
      await ctx.sendText("Settlement prepared successfully");
    }
    
  } catch (error) {
    console.error("Error initiating settlement:", error);
    await ctx.sendText(`Error initiating settlement: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Show tab creation menu with predefined template names.
 */
async function showCreateTabMenu(ctx: MessageContext, groupId: string): Promise<void> {
  const builder = ActionBuilder.create("create-tab-menu", "Choose a tab name. For a custom name, simply tag me (@capy) in a message like \"create tab for my weekend trip\"");

  // Register and add actions for each template
  for (const template of TAB_TEMPLATES) {
    const actionId = `create-tab-${template.id}`;
    
    registerAction(actionId, async (ctx) => {
      await createTabWithName(ctx, groupId, template.name);
    });

    builder.add(actionId, template.name);
  }

  await builder.send(ctx);
}

/**
 * Create a new tab with the specified name.
 */
async function createTabWithName(ctx: MessageContext, groupId: string, tabName: string): Promise<void> {
  try {
    const tabId = generateId();
    const allMembers = await getGroupMembers(groupId);
    
    // Exclude the agent from default participants
    const agent = await getXmtpAgent();
    const agentAddress = agent.address?.toLowerCase();
    const participants = agentAddress 
      ? allMembers.filter(member => member.address !== agentAddress)
      : allMembers;

    if (participants.length === 0) {
      await ctx.sendText(`No members found in group (excluding agent). Cannot create tab.`);
      return;
    }

    const tab = await createTab(groupId, tabId, tabName, "USDC", participants);

    const message = 
      `✅ Created tab "${tab.name}" with ${participants.length} participants!\n\n` +
      `You can now add expenses to this tab by tagging me in a message (@capy) like "I paid 100 USD for dinner".`;

    // Show success message
    await ctx.sendText(message);
  } catch (error) {
    console.error("Error creating tab:", error);
    await ctx.sendText(`Error creating tab: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Show group information (members and metadata).
 */
async function showGroupInfoDetails(ctx: MessageContext, groupId: string): Promise<void> {
  try {
    const { metadata, members } = await getGroupInfo(groupId);

    let output = `🥳 ${metadata.name}\n`;
    if (metadata.description) {
      output += `📝 ${metadata.description}\n\n`;
    }

    output += `\n👥 ${metadata.memberCount} Members:\n`;
    // Resolve display names for all members
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const displayName = await resolveAddressToDisplayName(member.address);
      output += `${displayName}\n`;
    }

    // Show info
    await ctx.sendText(output.trim());
  } catch (error) {
    console.error("Error showing group info:", error);
    await ctx.sendText(`Error loading group info: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Initialize all inline action handlers for the expense menu.
 * Call this once at application startup.
 */
export function initializeExpenseMenuActions(): void {
  // Main menu actions
  registerAction("create-poll", async (ctx) => {
    await ctx.sendText(
      'To create a poll simply tag me (@capy) in a message like "create poll for weekend destination with options beach mountains city"'
    );
  });

  registerAction("view-tabs", async (ctx) => {
    const groupId = ctx.conversation.id;
    await showTabsList(ctx, groupId);
  });

  registerAction("create-tab", async (ctx) => {
    const groupId = ctx.conversation.id;
    await showCreateTabMenu(ctx, groupId);
  });

  registerAction("group-info", async (ctx) => {
    const groupId = ctx.conversation.id;
    await showGroupInfoDetails(ctx, groupId);
  });

  console.log("✅ Expense menu inline actions initialized");
}

