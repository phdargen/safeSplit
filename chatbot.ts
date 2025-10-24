import * as dotenv from "dotenv";
import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { Agent as XMTPAgent, type MessageContext, type AgentMiddleware} from "@xmtp/agent-sdk";
import {
  TransactionReferenceCodec,
  ContentTypeTransactionReference,
  type TransactionReference,
} from "@xmtp/content-type-transaction-reference";
import {
  WalletSendCallsCodec,
} from "@xmtp/content-type-wallet-send-calls";
import {
  ContentTypeReaction,
  ReactionCodec,
  type Reaction,
} from "@xmtp/content-type-reaction";
import {
  ContentTypeMarkdown,
  MarkdownCodec,
} from "@xmtp/content-type-markdown";
import {
  AttachmentCodec,
  RemoteAttachmentCodec,
} from "@xmtp/content-type-remote-attachment";
import type { TransactionPrepared, MultiTransactionPrepared, SwapTransactionPrepared, PollPrepared } from "./lib/action-providers";
import { 
  initializeAgent, 
  buildConversationContext, 
  buildSenderContext,
  type Agent, 
  type AgentConfig,
} from "./lib/agent-config";
import { 
  ensureLocalStorage, 
  getConversationSession,
  saveConversationSession,
  initializeConversationSession,
  updateSessionMembers,
} from "./lib/session-manager";
import { sendSingleTransaction, sendSwapTransaction, sendMultipleTransactions } from "./lib/transaction-handler";
import { validateEnvironment } from "./lib/environment";
import { USDC_ADDRESSES } from "./lib/constants";
import { MemorySaver } from "@langchain/langgraph";
import { dumpMemory } from "./lib/utils";
import { handleSettlementTransaction } from "./lib/settlement-tracker";
import { ActionsCodec, ContentTypeActions, type ActionsContent } from "./utils/inline-actions/types/ActionsContent";
import { IntentCodec } from "./utils/inline-actions/types/IntentContent";
import { inlineActionsMiddleware } from "./utils/inline-actions/inline-actions";
import { 
  showMainMenu, 
  initializeExpenseMenuActions 
} from "./utils/inline-actions/expense-menu";
import { pollMiddleware } from "./utils/inline-actions/poll-middleware";
import { sendWelcomeMessage, sendConversationWelcomeMessage } from "./lib/welcome-message";
import { setSharedXmtpAgent } from "./lib/action-providers/xmtp/utils";

// Initialize environment variables
dotenv.config();

// Separate agent instances for DMs and groups (initialized once at startup)
let dmAgent: Agent;
let groupAgent: Agent;
let dmMemory: MemorySaver;
let groupMemory: MemorySaver;

// Cache of active thread IDs (cleared on restart)
const activeThreadsCache = new Set<string>();

/**
 * Process a message and detect if it contains a prepared transaction or poll.
 */
async function processMessage(
  agent: Agent,
  config: AgentConfig,
  messages: BaseMessage[],
): Promise<{
  response: string;
  transactionPrepared?: TransactionPrepared;
  swapTransactionPrepared?: SwapTransactionPrepared;
  multiTransactionPrepared?: MultiTransactionPrepared;
  pollPrepared?: PollPrepared;
}> {
  let response = "";
  let transactionPrepared: TransactionPrepared | undefined;
  let swapTransactionPrepared: SwapTransactionPrepared | undefined;
  let multiTransactionPrepared: MultiTransactionPrepared | undefined;
  let pollPrepared: PollPrepared | undefined;

  try {
    const stream = await agent.stream({ messages }, config);

    for await (const chunk of stream) {
      if ("agent" in chunk) {
        console.log("AGENT:", chunk.agent.messages[0].content + "\n");
        const content = String(chunk.agent.messages[0].content);
        response += content + "\n";
      } else if ("tools" in chunk && chunk.tools?.messages) {
        console.log("TOOL:", chunk.tools.messages[0].content + "\n");
        for (const toolMessage of chunk.tools.messages) {
          if (toolMessage.content) {
            try {
              const parsed = JSON.parse(String(toolMessage.content));
              if (parsed.type === "TRANSACTION_PREPARED") {
                console.log("🔧 Transaction prepared by tool:", parsed.description);
                transactionPrepared = parsed;
              } else if (parsed.type === "SWAP_TRANSACTION_PREPARED") {
                console.log("🔧 Swap transaction prepared by tool:", parsed.description);
                swapTransactionPrepared = parsed;
              } else if (parsed.type === "MULTI_TRANSACTION_PREPARED") {
                console.log("🔧 Multi-transaction prepared by tool:", parsed.description);
                multiTransactionPrepared = parsed;
              } else if (parsed.type === "POLL_PREPARED") {
                console.log("🔧 Poll prepared by tool:", parsed.poll.question);
                pollPrepared = parsed;
              }
            } catch {
              // Not JSON or not a transaction/poll preparation
            }
          }
        }
      }
      console.log("-------------------");
    }

    return {
      response: response.trim(),
      transactionPrepared,
      swapTransactionPrepared,
      multiTransactionPrepared,
      pollPrepared,
    };
  } catch (error) {
    console.error("Error processing message:", error);
    return {
      response: "Sorry, I encountered an error while processing your request. Please try again.",
    };
  }
}

/**
 * Handle incoming XMTP messages.
 */
async function handleMessage(ctx: MessageContext) {
  try {
    const senderInboxId = ctx.message.senderInboxId;
    const messageContent = String(ctx.message.content);
    const senderAddress = await ctx.getSenderAddress();
    const conversationId = ctx.conversation.id;
    const isGroup = ctx.isGroup();
    
    if (!senderAddress) {
      await ctx.sendText("Error: Could not determine your wallet address. Please try again.");
      return;
    }
    
    // Determine thread ID based on conversation type
    const threadId = isGroup ? conversationId : senderInboxId;
    
    console.log(`\n📨 Message from ${senderInboxId.slice(0, 8)}...: ${messageContent}`);
    console.log(`   Context: ${isGroup ? 'Group' : 'DM'} (thread: ${threadId.slice(0, 8)}...)`);
    
    // Check if thread is already loaded in this session (cache cleared on restart)
    if (!activeThreadsCache.has(threadId)) {
      // Not in cache - initialize/refresh session from XMTP
      await initializeConversationSession(ctx, threadId, isGroup);
      activeThreadsCache.add(threadId);
    }
    
    // Get session data (now guaranteed to exist)
    const session = getConversationSession(threadId, isGroup);
    
    // Update lastSeen timestamp
    if (session) {
      session.lastSeen = new Date();
      saveConversationSession(threadId, isGroup, session);
    }
    
    // Build messages array
    const messages: BaseMessage[] = [];
    
    // Always add conversation context (agent memory is separate from session storage)
    messages.push(new SystemMessage(
      buildConversationContext(conversationId, isGroup, session ? {
        groupName: session.groupName,
        groupDescription: session.groupDescription,
        groupImageUrl: session.groupImageUrl,
      } : undefined)
    ));
       
    // Append sender context to message
    messages.push(new HumanMessage(buildSenderContext(senderInboxId, senderAddress) + messageContent));
    
    // Select appropriate agent based on conversation type
    const selectedAgent = isGroup ? groupAgent : dmAgent;
    
    // Process with agent and specific thread
    const config = { configurable: { thread_id: threadId } };
    const result = await processMessage(selectedAgent, config, messages);
    
    // try {
    //   const mem = isGroup ? groupMemory : dmMemory;
    //   //await dumpMemory(mem, threadId);
    // } catch (e) {
    //   console.warn("Failed to dump MemorySaver:", e);
    // }

    // Handle poll preparation
    if (result.pollPrepared) {
      const poll = result.pollPrepared.poll;
      
      // Build action buttons for voting
      const actions = poll.options.map((opt, i) => ({
        id: String(i),
        label: opt,
      }));
      
      // Add "Show Results" button separated from voting options
      actions.push({
        id: "show-results",
        label: "📊 Show Results",
      });
      
      const deadline = new Date(poll.deadline).toLocaleString();
      const payload: ActionsContent = {
        id: poll.id,
        description: `🗳️ ${poll.question}\n⏰ ${deadline}\n\n`,
        actions,
      };
      
      await ctx.conversation.send(payload, ContentTypeActions);
      console.log(`✅ Poll created: ${poll.question}`);
      return;
    }
    
    // Handle transaction responses
    if (result.multiTransactionPrepared) {
      await sendMultipleTransactions(ctx, result.multiTransactionPrepared, result.response);
    } else if (result.swapTransactionPrepared) {
      await sendSwapTransaction(ctx, result.swapTransactionPrepared, senderAddress, result.response);
    } else if (result.transactionPrepared) {
      await sendSingleTransaction(ctx, result.transactionPrepared, senderAddress, result.response);
    } else {
      await ctx.sendText(result.response);
      console.log(`✅ Response from ${isGroup ? "group" : "DM"} agent: ${result.response}`);
    }
  } catch (error) {
    console.error("Error handling message:", error);
    await ctx.sendText(
      "I encountered an error while processing your request. Please try again later.",
    );
  }
}

/**
 * Transaction reference middleware to handle confirmed transactions.
 */
const transactionReferenceMiddleware: AgentMiddleware = async (ctx, next) => {
  if (ctx.message.contentType?.sameAs(ContentTypeTransactionReference)) {
    const transactionRef = ctx.message.content as TransactionReference;

    console.log('ctx.message', ctx.message);
    console.log(`Received transaction reference: ${transactionRef}`);

    // Check if this is a settlement transaction (will query Redis internally)
    const wasHandled = await handleSettlementTransaction(ctx, transactionRef);

    if (wasHandled) {
      return; // Settlement was handled
    }

    const blockExplorerUrl = process.env.NETWORK_ID === "base-mainnet" ? "https://basescan.org/tx/" : "https://sepolia.basescan.org/tx/";

    // Standard transaction confirmation (non-settlement)
    await ctx.conversation.send(
      `✅ Transaction confirmed!\n\n` +
        `📄 [View Transaction](${blockExplorerUrl}${transactionRef.reference})`,
      ContentTypeMarkdown
    );

    return;
  }

  await next();
};

/**
 * Main function to start the chatbot.
 */
async function main(): Promise<void> {
  console.log("🚀 Initializing External Wallet Agent on XMTP...\n");

  validateEnvironment();
  ensureLocalStorage();

  // Initialize both agent types at startup
  console.log("🤖 Initializing agents...");
  const { agent: initializedDmAgent, memory: initializedDmMemory } = await initializeAgent("dm");
  dmAgent = initializedDmAgent;
  dmMemory = initializedDmMemory;

  console.log("✅ DM agent ready");
  
  const { agent: initializedGroupAgent, memory: initializedGroupMemory } = await initializeAgent("group");
  groupAgent = initializedGroupAgent;
  groupMemory = initializedGroupMemory;
  console.log("✅ Group agent ready\n");

  // Create agent with necessary codecs
  const inboxId = process.env.AGENT_INBOX_ID || "1aa6e52fe4c8f6d5d58e1821e70227527bf18c44f8261c420952bab63e717ff0";
  const customDbPath = `${process.env.RAILWAY_VOLUME_MOUNT_PATH ?? '.'}/xmtp-${process.env.XMTP_ENV}-${inboxId}.db3`;
   
  const xmtpAgent = await XMTPAgent.createFromEnv({
    env: (process.env.XMTP_ENV as "local" | "dev" | "production") || "dev",
    codecs: [
      new WalletSendCallsCodec(),
      new TransactionReferenceCodec(),
      new ReactionCodec(),
      new ActionsCodec(),
      new IntentCodec(),
      new MarkdownCodec(),
      new RemoteAttachmentCodec(),
      new AttachmentCodec(),
    ],
    dbPath: customDbPath,
  });
  
  // Set the shared XMTP agent for action providers
  // This ensures group creation uses the same agent instance that listens for messages
  setSharedXmtpAgent(xmtpAgent);
  
  // Initialize expense menu inline actions
  initializeExpenseMenuActions();
  
  // Apply middlewares
  xmtpAgent.use(transactionReferenceMiddleware);
  xmtpAgent.use(inlineActionsMiddleware);
  xmtpAgent.use(pollMiddleware);

  // Handle DM conversations
  xmtpAgent.on("dm", async (ctx) => {
    console.log("New DM conversation detected");
    await sendConversationWelcomeMessage(ctx);
  });

  // Handle Group conversations
  xmtpAgent.on("group", async (ctx) => {
    console.log("New group conversation detected");
    await sendConversationWelcomeMessage(ctx);
  });

  // Handle all text messages
  xmtpAgent.on("text", async ctx => {
    const text = ctx.message.content.trim();
    console.log("text", text);
    
    const isGroup = ctx.isGroup();
    const lowerText = text.toLowerCase();
    
    // In group chats, only respond to messages with /capy or @capy tags
    // Exception: Allow /welcome and /info commands without tags
    if (isGroup) {
      const hasCapyTag = lowerText.includes("/capy") || lowerText.includes("@capy");
      const isWelcomeCommand = lowerText === "/welcome";
      const isInfoCommand = lowerText === "/info";
      
      if (!hasCapyTag && !isWelcomeCommand && !isInfoCommand) {
        return;
      }
    }
    
    // Handle /welcome command
    if (lowerText === "/welcome") {
      await sendWelcomeMessage(ctx);
      return;
    }
    
    // Handle /info command in groups
    if (lowerText === "/info") {
      if (isGroup) {
        await showMainMenu(ctx);
        return;
      }
      // In DMs, fall through to regular handler
    }
    
    await handleMessage(ctx);
  });

  // Handle group updates (member changes and metadata changes)
  xmtpAgent.on("group-update", async (ctx) => {
    try {
      const conversationId = ctx.conversation.id;
      const threadId = conversationId; // Groups use conversationId as threadId
      const content = ctx.message.content as any;

      console.log(`\n🔄 Group update for ${conversationId.slice(0, 8)}...`);
      console.log(`   Update content:`, JSON.stringify(content, null, 2));

      // Check if we have this group in cache
      const session = getConversationSession(threadId, true);
      
      if (!session) {
        console.log(`   Group not in cache, initializing...`);
        await initializeConversationSession(ctx, threadId, true);
        activeThreadsCache.add(threadId);
        return;
      }

      // Handle metadata changes
      if (content.metadataFieldChanges && Array.isArray(content.metadataFieldChanges)) {
        for (const change of content.metadataFieldChanges) {
          console.log(`   Metadata change: ${change.fieldName} = "${change.newValue}"`);
          
          if (change.fieldName === "group_name") {
            session.groupName = change.newValue;
          } else if (change.fieldName === "group_description") {
            session.groupDescription = change.newValue;
          } else if (change.fieldName === "group_image_url_square") {
            session.groupImageUrl = change.newValue;
          }
        }
      }

      // Handle member additions
      if (content.addedInboxes && Array.isArray(content.addedInboxes)) {
        console.log(`   Members added: ${content.addedInboxes.length}`);
        await updateSessionMembers(ctx, threadId);
      }

      // Handle member removals
      if (content.removedInboxes && Array.isArray(content.removedInboxes)) {
        console.log(`   Members removed: ${content.removedInboxes.length}`);
        
        // Remove from participants list
        for (const removed of content.removedInboxes) {
          session.participants = session.participants.filter(
            p => p.inboxId !== removed.inboxId
          );
        }
      }

      // Save updated session
      session.lastSeen = new Date();
      saveConversationSession(threadId, true, session);
      
      console.log(`   ✅ Session updated`);
    } catch (error) {
      console.error("Error handling group update:", error);
    }
  });

  // Log when agent starts
  xmtpAgent.on("start", () => {
    const env = process.env.XMTP_ENV || "dev";
    const networkId = process.env.NETWORK_ID || "base-sepolia";
    const usdcAddress = USDC_ADDRESSES[networkId];

    console.log("═".repeat(80));
    console.log("🎉 EXTERNAL WALLET AGENT STARTED");
    console.log("═".repeat(80));
    console.log(`📡 XMTP Environment:    ${env}`);
    console.log(`⛓️  Blockchain Network:   ${networkId}`);
    console.log(`💵 USDC Token Address:  ${usdcAddress || "Not available"}`);
    console.log(`📬 Agent Address:        ${xmtpAgent.address}`);
    console.log(`🔗 Chat with agent:      http://xmtp.chat/dm/${xmtpAgent.address}?env=${env}`);
    console.log("═".repeat(80));

    console.log("👂 Listening for messages...\n");
  });

  // Handle errors
  xmtpAgent.on("unhandledError", error => {
    console.error("❌ Unhandled error:", error);
  });

  await xmtpAgent.start();
}

// Start the chatbot
main().catch(error => {
  console.error("💥 Fatal error:", error);
  process.exit(1);
});

