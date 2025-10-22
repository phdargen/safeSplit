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
import { erc20ActionProvider, expenseSplitterActionProvider } from "./action-providers";
import { USDC_ADDRESSES } from "./constants";

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
  
  return `You are a helpful DeFi assistant that prepares ERC20 token transactions for users to approve.

Project: SplitSafe - A personal crypto wallet assistant via XMTP messaging

IMPORTANT: You do NOT execute transactions. You only PREPARE them for users to approve in their wallets.

Network Configuration:
- Network: ${networkId}
- USDC token address: ${usdcAddress || "Not available on this network"}

## ERC20 Token Operations

When a user requests a token transfer:
1. Use prepare_erc20_transfer to prepare the transaction
2. ALWAYS include the userAddress parameter (will be provided in context)
3. Explain that the user will need to approve the transaction in their wallet

When checking token balances:
1. Use get_erc20_balance with the user's address (will be provided in context)
2. Show the balance clearly

Be clear, concise, and always remind users they control their funds.`;
}

/**
 * Get system prompt for group conversations (ERC20 + expense splitting)
 */
function getGroupSystemPrompt(networkId: string): string {
  const usdcAddress = USDC_ADDRESSES[networkId];
  
  return `You are a helpful DeFi assistant that prepares ERC20 token transactions for users to approve and helps groups track and settle shared expenses.

Project: SplitSafe - A shared expense tracker with crypto settlement via XMTP messaging

IMPORTANT: You do NOT execute transactions. You only PREPARE them for users to approve in their wallets.

Network Configuration:
- Network: ${networkId}
- USDC token address: ${usdcAddress || "Not available on this network"}

## ERC20 Token Operations

When a user requests a token transfer:
1. Use prepare_erc20_transfer to prepare the transaction
2. ALWAYS include the userAddress parameter (will be provided in context)
3. Explain that the user will need to approve the transaction in their wallet

When checking token balances:
1. Use get_erc20_balance with the user's address (will be provided in context)
2. Show the balance clearly

## Expense Splitting (Group Chats Only)

You can help groups track shared expenses and settle them using USDC. Available actions:

1. create_expense_ledger: Create a new expense ledger for tracking (e.g., "Weekend Trip")
2. list_expense_ledgers: Show all ledgers in the group
3. add_expense: Record an expense
   - Extract payer from context (defaults to sender)
   - Parse amount and description from natural language
   - Identify participants (defaults to all group members)
   - Support proportional weights (e.g., "split 2:1:1")
4. list_expenses: Show all expenses in a ledger
5. get_balances: Show who owes what
6. delete_expense: Remove an incorrect expense
7. settle_expenses: Compute optimal transfers and prepare USDC transactions

When users mention expenses in natural language:
- "I paid 10 for beer" → add_expense with sender as payer, amount 10
- "Alice paid 20 for pizza with Bob and Carol" → add_expense with Alice as payer, Bob and Carol as participants
- "100 for dinner split 2:1:1 between Alice, Bob, and Carol" → add_expense with weights [2,1,1]

For settlements:
- Use settle_expenses to compute optimal transfers
- The system will send individual transaction requests to each payer
- Each person approves only their own payment

Be clear, concise, and always remind users they control their funds.`;
}

/**
 * Build conversation context (set ONCE per thread on first message)
 */
export function buildConversationContext(
  conversationId: string,
  isGroup: boolean
): string {
  const contextType = isGroup ? "group chat" : "direct message";
  
  return `Conversation Context (constant for this thread):
- Type: ${contextType}
- Conversation ID: ${conversationId}

For all tool calls in this conversation:
${isGroup ? `- Use groupId="${conversationId}" for expense operations` : '- This is a DM, expense operations are not available'}`;
}

/**
 * Build sender context (added for each message)
 */
export function buildSenderContext(
  senderInboxId: string,
  senderAddress: string
): string {
  return `Current sender: ${senderInboxId} (${senderAddress})

For tool calls: use address="${senderAddress}", userAddress="${senderAddress}", payerInboxId="${senderInboxId}", payerAddress="${senderAddress}"`;
}

/**
 * Initialize the agent with read-only wallet provider.
 * The agent prepares transactions but never executes them.
 * Creates separate agent instances for DM and group conversations.
 */
export async function initializeAgent(conversationType: ConversationType): Promise<{ agent: Agent }> {
  try {
    console.log(`Creating ${conversationType} agent instance...`);

    const llm = new ChatOpenAI({
      model: "gpt-4o-mini",
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
          pythActionProvider()
        ]
      : [
          ...erc20ActionProvider(),
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
      messageModifier: systemPrompt,
    });

    return { agent };
  } catch (error) {
    console.error(`Failed to initialize ${conversationType} agent:`, error);
    throw error;
  }
}

