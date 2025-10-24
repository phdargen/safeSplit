/**
 * Welcome message handler for first-time interactions.
 * Sends personalized welcome messages with Capy image attachment.
 */
import type { MessageContext, GroupMember, ConversationContext } from "@xmtp/agent-sdk";
import { ContentTypeMarkdown } from "@xmtp/content-type-markdown";
import { resolveAddressToDisplayName } from "./identity-resolver";

import * as dotenv from "dotenv";
dotenv.config();

/**
 * Check if this is the first time the agent is interacting with a conversation.
 * Returns true if the agent has never sent a message and wasn't a member before.
 */
export async function isFirstTimeInteraction(
  conversation: MessageContext["conversation"],
  client: MessageContext["client"],
): Promise<boolean> {
  try {
    const messages = await conversation.messages();
    const hasSentBefore = messages.some(
      (msg: any) => msg.senderInboxId.toLowerCase() === client.inboxId.toLowerCase(),
    );
    const members = await conversation.members();
    const wasMemberBefore = members.some(
      (member: GroupMember) =>
        member.inboxId.toLowerCase() === client.inboxId.toLowerCase() &&
        member.installationIds.length > 1,
    );

    return !hasSentBefore && !wasMemberBefore;
  } catch (error) {
    console.error("Error checking message history:", error);
    return false;
  }
}

/**
 * Send welcome message for new conversations (DM/Group events).
 * Used when a conversation is first created.
 */
export async function sendConversationWelcomeMessage(
  ctx: ConversationContext<unknown, any>
): Promise<void> {
  try {
    // Check if it's a group by checking for the name property
    const conversation = ctx.conversation as any;
    const isGroup = !!conversation.name;
    
    let welcomeText: string;
    if (isGroup) {
      // For groups, use group name
      const groupName = conversation.name || "everyone";

      welcomeText = `Hi **${groupName}** 👋

I am **Capy**, your friendly AI companion keeping tab of your expenses!

#### What I can do

- **Create poll** - Make group decisions together
- **Create tab** - Track and split shared expenses
- **Onchain transactions** - Prepare USDC transfers for your approval

---

💡 Type */info* or just tag me (*@capy*) in a message to get started!`;

    } else {
      // For DMs, use generic greeting
      welcomeText = `Hi there 👋

I am **Capy**, your friendly AI companion!

#### My specialties are in groups:

- **Create poll** - Make group decisions together
- **Create tab** - Track and split shared expenses
- 💡 To get started just tell me create a group with a list of your frens

#### In this DM I can also help you with:
- **Onchain transactions** - Prepared for your approval
    - Token transfers
    - Token swaps
- **Market info** - Real-time crypto/stock prices
`;
    }

    // Send welcome message with markdown
    await ctx.conversation.send(welcomeText, ContentTypeMarkdown);

  } catch (error) {
    console.error("Error sending conversation welcome message:", error);
    // Fallback to simple text message
    await ctx.conversation.send("Hi! I'm Capy, your expense tracking assistant. How can I help you today?");
  }
}

/**
 * Send welcome message with Capy image attachment.
 * Message is personalized based on whether it's a DM or Group.
 * Used for /welcome command or when replying to a message.
 */
export async function sendWelcomeMessage(ctx: MessageContext): Promise<void> {
  try {
    const isGroup = ctx.isGroup();
    const senderAddress = await ctx.getSenderAddress();
    
    // Get display name for personalization
    let welcomeText: string;
    if (isGroup) {
      // For groups, try to get group name
      const group = ctx.conversation as any;
      const groupName = group.name || "everyone";

      welcomeText = `Hi **${groupName}** 👋

I am **Capy**, your friendly AI companion keeping tab of your expenses!

#### What I can do

- **Create poll** - Make group decisions together
- **Create tab** - Track and split shared expenses
- **Onchain transactions** - Prepare USDC transfers for your approval

---

💡 Type */info* or just tag me (*@capy*) in a message to get started!`;

    } else {
      // For DMs, get sender's display name
      const displayName = senderAddress ? await resolveAddressToDisplayName(senderAddress) : "there";

      // Compose welcome message with markdown
      welcomeText = `Hi **${displayName}** 👋

I am **Capy**, your friendly AI companion!

#### My specialties are in groups:

- **Create poll** - Make group decisions together
- **Create tab** - Track and split shared expenses
- 💡 To get started just tell me create a group with a list of your frens

#### In this DM I can also help you with:
- **Onchain transactions** - Prepared for your approval
    - Token transfers
    - Token swaps
- **Market info** - Real-time crypto/stock prices
`;
    }

    // Send welcome message with markdown
    await ctx.conversation.send(welcomeText, ContentTypeMarkdown);

  } catch (error) {
    console.error("Error sending welcome message:", error);
    // Fallback to simple text message
    await ctx.sendText("Hi! I'm Capy, your expense tracking assistant. How can I help you today?");
  }
}

