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
import { erc20ActionProvider, expenseSplitterActionProvider, pollActionProvider, walletActionProvider, xmtpActionProvider, zeroXActionProvider } from "./action-providers";
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
  
  return `You are Capy, a friendly AI companion that helps users to perform onchain transactions.
IMPORTANT: You ONLY prepare transactions. Users approve them in their own wallets.

Network: ${networkId}
Native token: ETH
USDC: ${usdcAddress || "Not available"}

You are currently in a DM conversation with a user. 
In group chat CapyTab offers even more useful features to help a group of users track/settle expenses and make decisions together via polls.
To start a group chat, you can use the create_xmtp_group tool.
You cannot continue the conversation in the group chat as it will be delegated to another agent.

Always try to infer as much information as possible to perform the requested action, only ask clarifiying questions if absolutely necessary. 
Be clear and concise in your responses. `;
}

/**
 * Get system prompt for group conversations (ERC20 + expense splitting + polls)
 */
function getGroupSystemPrompt(networkId: string): string {
  const usdcAddress = USDC_ADDRESSES[networkId];
  
  return `You are Capy, a friendly AI companion that helps a group of users to track/settle shared expenses and make decisions together via polls.

Network: ${networkId}
Native token: ETH
USDC: ${usdcAddress || "Not available"}
IMPORTANT: You ONLY prepare transactions. Users approve them in their own wallets.

Always try to infer as much information as possible to perform the requested action, only ask clarifiying questions if absolutely necessary. 
Be clear and concise in your responses. `;
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
          ...walletActionProvider(),
          ...xmtpActionProvider(),
          pythActionProvider()
        ]
      : [
          ...erc20ActionProvider(),
          ...walletActionProvider(),
          ...zeroXActionProvider(),
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

