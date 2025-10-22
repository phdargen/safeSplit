import * as dotenv from "dotenv";
import * as fs from "fs";
import {
  AgentKit,
  pythActionProvider,
  NETWORK_ID_TO_VIEM_CHAIN,
} from "@coinbase/agentkit";
import { ReadOnlyEvmWalletProvider } from "./lib/wallet-providers";
import { erc20ActionProvider, type TransactionPrepared } from "./lib/action-providers";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { Agent as XMTPAgent, type MessageContext, type AgentMiddleware } from "@xmtp/agent-sdk";
import {
  TransactionReferenceCodec,
  ContentTypeTransactionReference,
  type TransactionReference,
} from "@xmtp/content-type-transaction-reference";
import {
  ContentTypeWalletSendCalls,
  WalletSendCallsCodec,
  type WalletSendCallsParams,
} from "@xmtp/content-type-wallet-send-calls";

// Initialize environment variables
dotenv.config();

// Storage constants
const STORAGE_DIR = ".data/user-sessions";

// USDC contract addresses by network
const USDC_ADDRESSES: Record<string, `0x${string}`> = {
  "base-mainnet": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "ethereum-mainnet": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "ethereum-sepolia": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
};

// Global stores for memory and agent instances
const memoryStore: Record<string, MemorySaver> = {};
const agentStore: Record<string, Agent> = {};

interface AgentConfig {
  configurable: {
    thread_id: string;
  };
}

interface UserSession {
  inboxId: string;
  ethereumAddress?: string;
  lastSeen?: Date;
}

type Agent = ReturnType<typeof createReactAgent>;

/**
 * Ensure local storage directory exists.
 */
function ensureLocalStorage() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

/**
 * Save user session data to storage.
 */
function saveUserSession(inboxId: string, data: UserSession): void {
  const localFilePath = `${STORAGE_DIR}/${inboxId}.json`;
  try {
    fs.writeFileSync(localFilePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Failed to save user session: ${error}`);
  }
}

/**
 * Get user session data from storage.
 */
function getUserSession(inboxId: string): UserSession | null {
  const localFilePath = `${STORAGE_DIR}/${inboxId}.json`;
  try {
    if (fs.existsSync(localFilePath)) {
      return JSON.parse(fs.readFileSync(localFilePath, "utf8"));
    }
  } catch (error) {
    console.warn(`Could not read user session: ${error}`);
  }
  return null;
}

/**
 * Initialize the agent with read-only wallet provider.
 * The agent prepares transactions but never executes them.
 */
async function initializeAgent(
  userId: string,
  userEthAddress: string,
): Promise<{ agent: Agent; config: AgentConfig }> {
  try {
    // Return existing agent if already initialized for this user
    if (agentStore[userId]) {
      console.log(`Using existing agent for user: ${userId}`);
      return {
        agent: agentStore[userId],
        config: { configurable: { thread_id: userId } },
      };
    }

    console.log(`Creating new agent for user: ${userId}`);

    const llm = new ChatOpenAI({
      model: "gpt-4o-mini",
    });

    // Create read-only wallet provider with user's address
    const walletProvider = ReadOnlyEvmWalletProvider.configure({
      networkId: process.env.NETWORK_ID || "base-sepolia",
      rpcUrl: process.env.RPC_URL,
      address: userEthAddress,
    });

    // Initialize AgentKit with external wallet action provider
    const agentkit = await AgentKit.from({
      walletProvider,
      actionProviders: [...erc20ActionProvider(), pythActionProvider()],
    });

    const tools = await getLangChainTools(agentkit);

    // Create or get memory for this user
    if (!memoryStore[userId]) {
      console.log(`Creating new memory store for user: ${userId}`);
      memoryStore[userId] = new MemorySaver();
    }

    const agentConfig: AgentConfig = {
      configurable: { thread_id: userId },
    };

    const networkId = process.env.NETWORK_ID || "base-sepolia";
    const usdcAddress = USDC_ADDRESSES[networkId];

    // Create the agent with specialized instructions
    const agent = createReactAgent({
      llm,
      tools,
      checkpointSaver: memoryStore[userId],
      messageModifier: `
        You are a helpful DeFi assistant that prepares ERC20 token transactions for users to approve.
        
        IMPORTANT: You do NOT execute transactions. You only PREPARE them for the user to approve in their wallet.
        
        Current Configuration:
        - Network: ${networkId}
        - User's wallet address: ${userEthAddress}
        - USDC token address: ${usdcAddress || "Not available on this network"}
        
        When a user requests a token transfer:
        1. Use prepare_erc20_transfer to prepare the transaction
        2. Always include the userAddress parameter: ${userEthAddress}
        3. Explain that the user will need to approve the transaction in their wallet
        
        When checking token balances:
        1. Use get_erc20_balance with the user's address: ${userEthAddress}
        2. Show the balance clearly
        
        For USDC operations on ${networkId}:
        - Use token address: ${usdcAddress}
        
        Be clear, concise, and always remind users they control their funds.
      `,
    });

    agentStore[userId] = agent;

    return { agent, config: agentConfig };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw error;
  }
}

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
}> {
  let response = "";
  let transactionPrepared: TransactionPrepared | undefined;

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

    // If a transaction was prepared, convert to WalletSendCalls and send
    if (result.transactionPrepared) {
      const networkId = process.env.NETWORK_ID || "base-sepolia";
      const chain = NETWORK_ID_TO_VIEM_CHAIN[networkId as keyof typeof NETWORK_ID_TO_VIEM_CHAIN];
      
      if (!chain) {
        await ctx.sendText(`Error: Unsupported network ${networkId}`);
        return;
      }

      const chainId = `0x${chain.id.toString(16)}` as `0x${string}`;

      const walletSendCalls: WalletSendCallsParams = {
        version: "1.0",
        from: senderAddress as `0x${string}`,
        chainId: chainId,
        calls: result.transactionPrepared.calls.map(call => ({
          to: call.to as `0x${string}`,
          data: call.data as `0x${string}`,
          value: call.value as `0x${string}`,
          metadata: {
            description: result.transactionPrepared!.description,
            transactionType: "erc20_transfer",
            currency: result.transactionPrepared!.metadata.tokenName || "ERC20",
            amount: result.transactionPrepared!.metadata.amount,
            decimals: result.transactionPrepared!.metadata.tokenDecimals?.toString() || "18",
            toAddress: result.transactionPrepared!.metadata.destinationAddress,
            tokenAddress: result.transactionPrepared!.metadata.tokenAddress,
          },
        })),
      };

      console.log(`💳 Sending transaction request to user's wallet...`);
      
      // Send the transaction request to user's wallet
      await ctx.conversation.send(walletSendCalls, ContentTypeWalletSendCalls);
      
      // Send explanatory message
      await ctx.sendText(
        `${result.response}\n\n💡 Please approve this transaction in your wallet to complete the transfer.`,
      );

      console.log(`✅ Transaction request sent`);
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
 * Validates environment variables.
 */
function validateEnvironment(): void {
  const missingVars: string[] = [];

  const requiredVars = [
    "OPENAI_API_KEY",
    "XMTP_WALLET_KEY",
    "XMTP_DB_ENCRYPTION_KEY",
  ];

  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });

  if (missingVars.length > 0) {
    console.error("❌ Error: Required environment variables are not set");
    missingVars.forEach(varName => {
      console.error(`   ${varName}=your_${varName.toLowerCase()}_here`);
    });
    process.exit(1);
  }

  if (!process.env.NETWORK_ID) {
    console.warn("⚠️  Warning: NETWORK_ID not set, defaulting to base-sepolia");
  }

  if (!process.env.XMTP_ENV) {
    console.warn("⚠️  Warning: XMTP_ENV not set, defaulting to dev");
  }
}

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

