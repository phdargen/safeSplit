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
import { getGroupInfo, getGroupMembers } from "../../lib/action-providers/xmtp/utils";
import { resolveAddressToDisplayName } from "../../lib/identity-resolver";
import { formatCurrency } from "../../lib/action-providers/expenseSplitter/utils";
import { generateId } from "../../lib/action-providers/expenseSplitter/utils";

// Predefined tab name templates
const TAB_TEMPLATES = [
  { id: "weekend-trip", name: "Weekend Trip" },
  { id: "dinner", name: "Dinner" },
  { id: "monthly-expenses", name: "Monthly Expenses" },
  { id: "trip", name: "Trip" },
  { id: "other-event", name: "Other Event" },
];

/**
 * Show the main info menu with primary actions.
 */
export async function showMainMenu(ctx: MessageContext): Promise<void> {
  await ActionBuilder.create("info-main-menu", "What would you like to do?")
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
      await ActionBuilder.create("no-tabs", "No tabs yet! Create your first tab:")
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
    let message = `📊 ${tab.name}\n\n`;
    message += `Status: ${tab.status}\n`;
    message += `Currency: ${tab.currency}\n`;
    message += `Participants: ${tab.participants.length}\n`;
    message += `Total Expenses: ${formatCurrency(totalExpenses, tab.currency)}\n\n`;

    // Show expenses
    if (tab.expenses.length > 0) {
      message += `📋 Expenses (${tab.expenses.length}):\n\n`;
      
      for (const expense of tab.expenses.slice(-5)) { // Show last 5 expenses
        const payerDisplayName = await resolveAddressToDisplayName(expense.payerAddress);
        const date = new Date(expense.timestamp).toLocaleDateString();
        message += `• ${formatCurrency(expense.amount, expense.currency)} - ${expense.description}\n`;
        message += `  Paid by: ${payerDisplayName}\n`;
        message += `  Date: ${date}\n\n`;
      }

      if (tab.expenses.length > 5) {
        message += `... and ${tab.expenses.length - 5} more\n\n`;
      }

      // Calculate and show balances
      const balances = calculateDetailedBalances(tab.expenses, tab.participants);
      
      message += `💳 Balances:\n\n`;
      
      const owed = balances.filter(b => b.status === "owed");
      const owes = balances.filter(b => b.status === "owes");
      const settled = balances.filter(b => b.status === "settled");

      if (owed.length > 0) {
        message += `✅ Owed to:\n`;
        for (const balance of owed) {
          const displayName = await resolveAddressToDisplayName(balance.address);
          message += `  • ${displayName}: +${formatCurrency(balance.netSettlement, tab.currency)}\n`;
        }
        message += `\n`;
      }

      if (owes.length > 0) {
        message += `💸 Owes:\n`;
        for (const balance of owes) {
          const displayName = await resolveAddressToDisplayName(balance.address);
          const absAmount = (parseFloat(balance.netSettlement) * -1).toString();
          message += `  • ${displayName}: ${formatCurrency(absAmount, tab.currency)}\n`;
        }
        message += `\n`;
      }

      if (settled.length > 0) {
        message += `⚖️  Settled:\n`;
        for (const balance of settled) {
          const displayName = await resolveAddressToDisplayName(balance.address);
          message += `  • ${displayName}: ${formatCurrency("0", tab.currency)}\n`;
        }
      }
    } else {
      message += `No expenses recorded yet.`;
    }

    // Register navigation actions
    const settleActionId = `settle-tab-${tabId}`;
    registerAction(settleActionId, async (ctx) => {
      await initiateSettlement(ctx, groupId, tabId);
    });

    // Show details with settle button only
    await ActionBuilder.create(`tab-details-${tabId}`, message)
      .add(settleActionId, "💰 Settle Tab")
      .send(ctx);
  } catch (error) {
    console.error("Error showing tab details:", error);
    await ctx.sendText(`Error loading tab details: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Initiate settlement for a tab.
 * Note: This will trigger the LangChain agent's settle_expenses tool via a message.
 */
async function initiateSettlement(ctx: MessageContext, groupId: string, tabId: string): Promise<void> {
  try {
    const tab = await getTab(groupId, tabId);
    if (!tab) {
      await ctx.sendText("Tab not found");
      return;
    }

    if (tab.expenses.length === 0) {
      await ctx.sendText(`No expenses in tab "${tab.name}". Nothing to settle!`);
      return;
    }

    // Send a message that will trigger the agent to settle
    await ctx.sendText(`Settling tab "${tab.name}"... Please wait.`);
    
    // This will be processed by the regular agent handler which will call settle_expenses
    // We send it as a system-like message that the agent will understand
    await ctx.sendText(`settle expenses for tab ${tabId} in group ${groupId}`);
    
  } catch (error) {
    console.error("Error initiating settlement:", error);
    await ctx.sendText(`Error initiating settlement: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Show tab creation menu with predefined template names.
 */
async function showCreateTabMenu(ctx: MessageContext, groupId: string): Promise<void> {
  const builder = ActionBuilder.create("create-tab-menu", "Choose a tab name:");

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
    const participants = await getGroupMembers(groupId);

    if (participants.length === 0) {
      await ctx.sendText(`No members found in group. Cannot create tab.`);
      return;
    }

    const tab = await createTab(groupId, tabId, tabName, "USDC", participants);

    const message = 
      `✅ Created tab "${tab.name}" with ${participants.length} participants!\n\n` +
      `You can now add expenses to this tab by talking to me.`;

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

    const createdDate = new Date(metadata.createdAt).toLocaleString();

    let output = `📋 Group Information\n\n`;
    output += `📛 Name: ${metadata.name}\n`;
    output += `📅 Created: ${createdDate}\n`;
    output += `👥 Members: ${metadata.memberCount}\n`;

    if (metadata.description) {
      output += `📝 Description: ${metadata.description}\n`;
    }

    output += `\n👥 Group Members:\n\n`;

    // Resolve display names for all members
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const displayName = await resolveAddressToDisplayName(member.address);
      output += `${i + 1}. ${displayName}\n`;
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

