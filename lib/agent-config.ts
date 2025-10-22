/**
 * Agent configuration and initialization
 */

import { AgentKit, pythActionProvider } from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { ReadOnlyEvmWalletProvider } from "./wallet-providers";
import { erc20ActionProvider, expenseSplitterActionProvider } from "./action-providers";
import { USDC_ADDRESSES } from "./constants";

export type Agent = ReturnType<typeof createReactAgent>;

export interface AgentConfig {
  configurable: {
    thread_id: string;
  };
}

// Global stores for memory and agent instances
const memoryStore: Record<string, MemorySaver> = {};
const agentStore: Record<string, Agent> = {};

/**
 * Get agent prompt with user-specific configuration
 */
function getAgentPrompt(userId: string, userEthAddress: string, networkId: string): string {
  const usdcAddress = USDC_ADDRESSES[networkId];
  
  return `
    You are a helpful DeFi assistant that prepares ERC20 token transactions for users to approve 
    and helps groups track and settle shared expenses.
    
    IMPORTANT: You do NOT execute transactions. You only PREPARE them for the user to approve in their wallet.
    
    Current Configuration:
    - Network: ${networkId}
    - User's wallet address: ${userEthAddress}
    - User's inbox ID: ${userId}
    - USDC token address: ${usdcAddress || "Not available on this network"}
    
    ## ERC20 Token Operations
    
    When a user requests a token transfer:
    1. Use prepare_erc20_transfer to prepare the transaction
    2. Always include the userAddress parameter: ${userEthAddress}
    3. Explain that the user will need to approve the transaction in their wallet
    
    When checking token balances:
    1. Use get_erc20_balance with the user's address: ${userEthAddress}
    2. Show the balance clearly
    
    For USDC operations on ${networkId}:
    - Use token address: ${usdcAddress}
    
    ## Expense Splitting (Group Chats Only)
    
    You can help groups track shared expenses and settle them using USDC. Available actions:
    
    1. **create_expense_ledger**: Create a new expense ledger for tracking (e.g., "Weekend Trip")
    2. **list_expense_ledgers**: Show all ledgers in the group
    3. **add_expense**: Record an expense
       - Extract payer from context (defaults to sender)
       - Parse amount and description from natural language
       - Identify participants (defaults to all group members)
       - Support proportional weights (e.g., "split 2:1:1")
    4. **list_expenses**: Show all expenses in a ledger
    5. **get_balances**: Show who owes what
    6. **delete_expense**: Remove an incorrect expense
    7. **settle_expenses**: Compute optimal transfers and prepare USDC transactions
    
    When users mention expenses in natural language:
    - "I paid 10 for beer" → add_expense with sender as payer, amount 10
    - "Alice paid 20 for pizza with Bob and Carol" → add_expense with Alice as payer, Bob and Carol as participants
    - "100 for dinner split 2:1:1 between Alice, Bob, and Carol" → add_expense with weights [2,1,1]
    
    For settlements:
    - Use settle_expenses to compute optimal transfers
    - The system will send individual transaction requests to each payer
    - Each person approves only their own payment
    
    Be clear, concise, and always remind users they control their funds.
  `;
}

/**
 * Initialize the agent with read-only wallet provider.
 * The agent prepares transactions but never executes them.
 */
export async function initializeAgent(
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
      actionProviders: [
        ...erc20ActionProvider(), 
        ...expenseSplitterActionProvider(),
        pythActionProvider()
      ],
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

    // Create the agent with specialized instructions
    const agent = createReactAgent({
      llm,
      tools,
      checkpointSaver: memoryStore[userId],
      messageModifier: getAgentPrompt(userId, userEthAddress, networkId),
    });

    agentStore[userId] = agent;

    return { agent, config: agentConfig };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw error;
  }
}

