# Inline Actions for Expense Management

This module provides a button-based UI for managing expense tabs in XMTP groups using inline actions (XIP-67 spec).

## Usage

In any XMTP group, send `/info` to open the interactive menu.

## Menu Structure

### Main Menu
- **📋 View Tabs** - List all expense tabs in the group
- **➕ Create Tab** - Create a new expense tab with a predefined name
- **👥 Group Info** - View group members and metadata

### View Tabs Flow
1. Shows all tabs as clickable buttons with their totals
2. Click any tab to see tab-specific menu:
   - **📊 View Details** - See expenses and balances
   - **💰 Settle Tab** - Initiate settlement (delegates to agent)
   - **⬅️ Back to Tabs** - Return to tab list

### Create Tab Flow
Shows predefined tab name templates:
- Weekend Trip
- Dinner
- Monthly Expenses
- Trip
- Other Event

Clicking any template creates the tab immediately with all group members.

### Group Info
Displays:
- Group name and metadata
- Creation date
- All group members with their display names (ENS/Basename)

## Implementation Details

### Files
- `expense-menu.ts` - Main menu logic and action handlers
- `inline-actions.ts` - Core inline actions framework
- `types/ActionsContent.ts` - Actions content type codec
- `types/IntentContent.ts` - Intent content type codec

### Integration
The expense menu is initialized in `chatbot.ts`:
```typescript
import { showMainMenu, initializeExpenseMenuActions } from "./utils/inline-actions/expense-menu";

// Initialize at startup
initializeExpenseMenuActions();

// Apply middleware
xmtpAgent.use(inlineActionsMiddleware);

// Handle /info command
xmtpAgent.on("text", async ctx => {
  if (text === "/info" && ctx.isGroup()) {
    await showMainMenu(ctx);
    return;
  }
  // ... other handlers
});
```

### Dynamic Action Registration
Tab-specific actions are registered dynamically when viewing tabs:
```typescript
for (const tab of tabs) {
  const actionId = `view-tab-${tab.id}`;
  registerAction(actionId, async (ctx) => {
    await showTabMenu(ctx, groupId, tab.id);
  });
  builder.add(actionId, `🗂️ ${tab.name}`);
}
```

### Settlement Delegation
When "Settle Tab" is clicked, the system sends a natural language message that triggers the LangChain agent's `settle_expenses` tool:
```typescript
await ctx.sendText(`settle expenses for tab ${tabId} in group ${groupId}`);
```

This allows the agent to handle the complex settlement logic while keeping the inline actions simple and focused on UI.

## Design Principles

1. **Discrete Choices Only** - No text input required, all interactions are button-based
2. **Direct Storage Calls** - Read operations call storage functions directly for speed
3. **Agent Delegation** - Complex operations (like settlement) delegate to the LangChain agent
4. **Display Names** - Uses ENS/Basename resolution for friendly user display
5. **Group-Only** - Only works in groups (checked via `ctx.isGroup()`)

## Error Handling

- Missing tabs show "No tabs yet" with create button
- Redis errors are caught and displayed to user
- Invalid tab IDs show "Tab not found" message
- DMs silently fall through to regular agent handler
