/**
 * Agent configuration and initialization
 */

import { AgentKit, pythActionProvider } from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { privateKeyToAccount } from "viem/accounts";
import { ReadOnlyEvmWalletProvider } from "./wallet-providers";
import { erc20ActionProvider, expenseSplitterActionProvider, pollActionProvider, xmtpActionProvider } from "./action-providers";
import { USDC_ADDRESSES } from "./constants";
import { SystemMessage } from "@langchain/core/messages";

export type Agent = ReturnType<typeof createReactAgent>;

export interface AgentConfig {
  configurable: {
    thread_id: string;
  };
}

export type ConversationType = "dm" | "group";

/**
 * Get system prompt for DM conversations (ERC20 operations only)
 */
function getDMSystemPrompt(networkId: string): string {
  const usdcAddress = USDC_ADDRESSES[networkId];
  
  return `You are SplitSafe, a DeFi assistant that prepares ERC20 transactions for user approval.

IMPORTANT: You ONLY prepare transactions. Users approve them in their own wallets.

Network: ${networkId}
USDC: ${usdcAddress || "Not available"}

You have tools to check balances, prepare transfers, and view group information.

IDENTITY RESOLUTION:
- Users can send funds using ENS names, Basenames, or Ethereum addresses
- Names without .eth suffix automatically get .base.eth appended
- All outputs will show ENS/Basename names instead of raw addresses where possible

Be clear and concise. Users control their funds.`;
}

/**
 * Get system prompt for group conversations (ERC20 + expense splitting + polls)
 */
function getGroupSystemPrompt(networkId: string): string {
  const usdcAddress = USDC_ADDRESSES[networkId];
  
  return `You are SplitSafe, a DeFi assistant that prepares ERC20 transactions and helps groups track shared expenses and create polls.

IMPORTANT: You ONLY prepare transactions. Users approve them in their own wallets.

Network: ${networkId}
USDC: ${usdcAddress || "Not available"}

In groups, you can create polls, track expenses, and compute optimal settlements using USDC.
Use available tools to check balances, prepare transfers, view group info, manage expenses, and create polls for group decisions.

EXPENSE RECORDING RULES:
- When adding expenses, the payerAddress can be an Ethereum address, ENS name, or Basename
- If the sender says "I paid" or doesn't specify who paid, use their senderAddress as payerAddress
- If the sender says "X paid", you can use X's ENS/Basename or address - the system will resolve it
- Names without .eth suffix automatically get .base.eth appended

IDENTITY RESOLUTION:
- Users can reference people by ENS name, Basename, or Ethereum address
- Names without .eth suffix automatically get .base.eth appended (e.g., "alice" becomes "alice.base.eth")
- All outputs will show ENS/Basename names instead of raw addresses where possible
- You don't need to ask for addresses - just use the names provided by users

Be clear and concise. Users control their funds.`;
}

/**
 * Build conversation context (set ONCE per thread on first message)
 */
export function buildConversationContext(
  conversationId: string,
  isGroup: boolean,
  groupMetadata?: {
    groupName?: string;
    groupDescription?: string;
    groupImageUrl?: string;
  }
): string {
  if (isGroup && groupMetadata?.groupName) {
    return `Group: "${groupMetadata.groupName}" (groupId: ${conversationId})`;
  }
  if (isGroup) {
    return `groupId: ${conversationId}`;
  }
  return ''; // DM - no context needed, senderAddress in per-message context
}

/**
 * Build sender context (added for each message)
 */
export function buildSenderContext(
  senderInboxId: string,
  senderAddress: string
): string {
  return `senderInboxId: ${senderInboxId}, senderAddress: ${senderAddress}\n\n`;
}

/**
 * Initialize the agent with read-only wallet provider.
 * The agent prepares transactions but never executes them.
 * Creates separate agent instances for DM and group conversations.
 */
export async function initializeAgent(conversationType: ConversationType): Promise<{ agent: Agent; memory: MemorySaver }> {
  try {
    console.log(`Creating ${conversationType} agent instance...`);

    const llm = new ChatOpenAI({
      model: process.env.LLM_MODEL || "gpt-4o-mini",
    });

    // Derive agent's wallet address from private key (for RPC access only)
    const walletKey = process.env.XMTP_WALLET_KEY;
    if (!walletKey) {
      throw new Error("XMTP_WALLET_KEY is required");
    }
    const account = privateKeyToAccount(walletKey as `0x${string}`);
    const agentAddress = account.address;
    console.log("agentAddress", agentAddress);

    const walletProvider = ReadOnlyEvmWalletProvider.configure({
      networkId: process.env.NETWORK_ID || "base-sepolia",
      rpcUrl: process.env.RPC_URL,
      address: agentAddress,
    });

    // Initialize AgentKit with appropriate action providers based on conversation type
    const actionProviders = conversationType === "group" 
      ? [
          ...erc20ActionProvider(), 
          ...expenseSplitterActionProvider(),
          ...pollActionProvider(),
          ...xmtpActionProvider(),
          pythActionProvider()
        ]
      : [
          ...erc20ActionProvider(),
          ...xmtpActionProvider(),
          pythActionProvider()
        ];

    const agentkit = await AgentKit.from({
      walletProvider,
      actionProviders,
    });

    const tools = await getLangChainTools(agentkit);

    // Separate memory instance for each conversation type
    const memory = new MemorySaver();

    const networkId = process.env.NETWORK_ID || "base-sepolia";

    // Select appropriate system prompt based on conversation type
    const systemPrompt = conversationType === "group" 
      ? getGroupSystemPrompt(networkId)
      : getDMSystemPrompt(networkId);

    // Create the agent with type-specific system prompt
    const agent = createReactAgent({
      llm,
      tools,
      checkpointSaver: memory,
      prompt: new SystemMessage(systemPrompt),
    });

    return { agent, memory };
  } catch (error) {
    console.error(`Failed to initialize ${conversationType} agent:`, error);
    throw error;
  }
}

