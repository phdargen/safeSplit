import * as dotenv from "dotenv";
import { HumanMessage } from "@langchain/core/messages";
import { Agent as XMTPAgent, type MessageContext, type AgentMiddleware } from "@xmtp/agent-sdk";
import {
  TransactionReferenceCodec,
  ContentTypeTransactionReference,
  type TransactionReference,
} from "@xmtp/content-type-transaction-reference";
import {
  WalletSendCallsCodec,
} from "@xmtp/content-type-wallet-send-calls";
import type { TransactionPrepared, MultiTransactionPrepared } from "./lib/action-providers";
import { initializeAgent, type Agent, type AgentConfig } from "./lib/agent-config";
import { 
  ensureLocalStorage, 
  getUserSession, 
  saveUserSession,
} from "./lib/session-manager";
import { sendSingleTransaction, sendMultipleTransactions } from "./lib/transaction-handler";
import { validateEnvironment } from "./lib/environment";
import { USDC_ADDRESSES } from "./lib/constants";

// Initialize environment variables
dotenv.config();


/**
 * Process a message and detect if it contains a prepared transaction.
 */
async function processMessage(
  agent: Agent,
  config: AgentConfig,
  message: string,
): Promise<{
  response: string;
  transactionPrepared?: TransactionPrepared;
  multiTransactionPrepared?: MultiTransactionPrepared;
}> {
  let response = "";
  let transactionPrepared: TransactionPrepared | undefined;
  let multiTransactionPrepared: MultiTransactionPrepared | undefined;

  try {
    const stream = await agent.stream({ messages: [new HumanMessage(message)] }, config);

    for await (const chunk of stream) {
      // Check for tool outputs (this is where the raw JSON comes from)
      if ("tools" in chunk && chunk.tools?.messages) {
        for (const toolMessage of chunk.tools.messages) {
          if (toolMessage.content) {
            try {
              const parsed = JSON.parse(String(toolMessage.content));
              if (parsed.type === "TRANSACTION_PREPARED") {
                console.log("🔧 Transaction prepared by tool:", parsed.description);
                transactionPrepared = parsed;
              } else if (parsed.type === "MULTI_TRANSACTION_PREPARED") {
                console.log("🔧 Multi-transaction prepared by tool:", parsed.description);
                multiTransactionPrepared = parsed;
              }
            } catch {
              // Not JSON or not a transaction preparation
            }
          }
        }
      }

      // Get the final agent response for the user
      if ("agent" in chunk) {
        const content = String(chunk.agent.messages[0].content);
        response += content + "\n";
      }
    }

    return {
      response: response.trim(),
      transactionPrepared,
      multiTransactionPrepared,
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
    const userId = ctx.message.senderInboxId;
    const messageContent = String(ctx.message.content);
    console.log(`\n📨 Message from ${userId.slice(0, 8)}...: ${messageContent}`);

    // Get user's Ethereum address from XMTP
    const senderAddress = await ctx.getSenderAddress();
    if (!senderAddress) {
      await ctx.sendText("Error: Could not determine your wallet address. Please try again.");
      return;
    }

    // Update user session
    let userSession = getUserSession(userId);
    if (!userSession) {
      userSession = {
        inboxId: userId,
        ethereumAddress: senderAddress,
        lastSeen: new Date(),
      };
    } else {
      userSession.ethereumAddress = senderAddress;
      userSession.lastSeen = new Date();
    }
    saveUserSession(userId, userSession);

    // Initialize agent with user's address
    const { agent, config } = await initializeAgent(userId, senderAddress);

    // Process the message
    const result = await processMessage(agent, config, messageContent);

    // Handle transaction responses
    if (result.multiTransactionPrepared) {
      await sendMultipleTransactions(ctx, result.multiTransactionPrepared, result.response);
    } else if (result.transactionPrepared) {
      await sendSingleTransaction(ctx, result.transactionPrepared, senderAddress, result.response);
    } else {
      // Regular text response
      await ctx.sendText(result.response);
      console.log(`✅ Response sent`);
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

    console.log(`\n✅ Transaction confirmed: ${transactionRef.reference}`);

    await ctx.sendText(
      `✅ Transaction confirmed!\n` +
        `🔗 Network: ${transactionRef.networkId}\n` +
        `📄 Hash: ${transactionRef.reference}\n` +
        `\nThank you for using the external wallet agent!`,
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

  // Create XMTP agent with transaction codecs
  const xmtpAgent = await XMTPAgent.createFromEnv({
    env: (process.env.XMTP_ENV as "local" | "dev" | "production") || "dev",
    codecs: [new WalletSendCallsCodec(), new TransactionReferenceCodec()],
  });

  // Apply transaction reference middleware
  xmtpAgent.use(transactionReferenceMiddleware);

  // Handle all text messages
  xmtpAgent.on("text", async ctx => {
    await handleMessage(ctx);
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
    console.log("\n💡 This agent prepares ERC20 transactions for users to approve with their own wallets.");
    console.log("   Users maintain full control of their funds!\n");
    console.log("🎯 Try these commands:");
    console.log("   • Check my USDC balance");
    console.log("   • Send 1 USDC to 0x...");
    console.log("   • What's my wallet balance?\n");
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

