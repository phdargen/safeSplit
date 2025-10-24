import { z } from "zod";
import { customActionProvider, EvmWalletProvider } from "@coinbase/agentkit";
import { GetBalanceSchema, PrepareTransferSchema, GetTokenAddressSchema } from "./schemas";
import { TransactionPrepared } from "./types";
import { getTokenDetails } from "./utils";
import { TOKEN_ADDRESSES_BY_SYMBOLS } from "./constants";
import { encodeFunctionData, Hex, getAddress, erc20Abi, parseUnits } from "viem";
import { resolveIdentifierToAddress, resolveAddressToDisplayName } from "../../identity-resolver";

/**
 * Gets the balance of an ERC20 token for a user's wallet address.
 *
 * @param walletProvider - The wallet provider (used only for RPC access).
 * @param args - The input arguments for the action.
 * @returns A message containing the balance.
 */
async function getBalance(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof GetBalanceSchema>,
): Promise<string> {
  const tokenDetails = await getTokenDetails(walletProvider, args.tokenAddress, args.address);

  if (!tokenDetails) {
    return `Error: Could not fetch token details for ${args.tokenAddress}. Please verify the token address is correct.`;
  }

  return `Balance of ${tokenDetails.name} (${args.tokenAddress}) at address ${args.address} is ${tokenDetails.formattedBalance}`;
}

/**
 * Prepares an ERC20 transfer transaction for user approval.
 * Returns a JSON string with transaction data that must be parsed and converted
 * to WalletSendCalls format by the chatbot.
 *
 * @param walletProvider - The wallet provider (used only for RPC access).
 * @param args - The input arguments for the action.
 * @returns A JSON string containing the prepared transaction data.
 */
async function prepareTransfer(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof PrepareTransferSchema>,
): Promise<string> {
  try {
    // Resolve destination identifier to address
    let destinationAddress: string;
    try {
      destinationAddress = await resolveIdentifierToAddress(args.destinationAddress);
    } catch (error) {
      return `Error: Could not resolve destination identifier "${args.destinationAddress}": ${error}`;
    }

    // Get destination display name for user-friendly messages
    const destinationDisplayName = await resolveAddressToDisplayName(destinationAddress);

    // Validate and normalize token address
    const tokenAddress = getAddress(args.tokenAddress);

    // Get token details for validation and better error messages
    const tokenDetails = await getTokenDetails(
      walletProvider,
      args.tokenAddress,
      args.userAddress,
    );

    if (!tokenDetails) {
      return `Error: Could not fetch token details for ${args.tokenAddress}. Please verify the token address is correct.`;
    }

    // Convert amount to token units using correct decimals
    const amountInUnits = parseUnits(String(args.amount), tokenDetails.decimals);

    // Check if user has sufficient balance
    if (tokenDetails.balance < amountInUnits) {
      return `Error: Insufficient ${tokenDetails.name} balance. User has ${tokenDetails.formattedBalance} ${tokenDetails.name}, but trying to send ${args.amount} ${tokenDetails.name}.`;
    }

    // Guardrails to prevent loss of funds
    if (args.tokenAddress.toLowerCase() === destinationAddress.toLowerCase()) {
      return "Error: Transfer destination is the token contract address. Refusing to prepare transaction to prevent loss of funds.";
    }

    // Check if destination is a contract
    const destinationCode = await walletProvider.getPublicClient().getCode({
      address: destinationAddress as Hex,
    });

    if (destinationCode && destinationCode !== "0x") {
      // Check if it's an ERC20 token contract
      const destTokenDetails = await getTokenDetails(
        walletProvider,
        destinationAddress,
        args.userAddress,
      );
      if (destTokenDetails) {
        return "Error: Transfer destination is an ERC20 token contract. Refusing to prepare transaction to prevent loss of funds.";
      }
      // If it's a contract but not an ERC20 token (e.g., a smart wallet), allow it
    }

    // Encode the transfer function call
    const transferData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [destinationAddress as Hex, amountInUnits],
    });

    // Return structured response that will be parsed by the chatbot (with display name)
    const response: TransactionPrepared = {
      type: "TRANSACTION_PREPARED",
      description: `Transfer ${args.amount} ${tokenDetails.name} to ${destinationDisplayName}`,
      calls: [
        {
          to: tokenAddress,
          data: transferData,
          value: "0",
        },
      ],
      metadata: {
        tokenAddress,
        amount: args.amount,
        destinationAddress,
        destinationDisplayName,
        tokenName: tokenDetails.name,
        tokenDecimals: tokenDetails.decimals,
      },
    };

    return JSON.stringify(response);
  } catch (error) {
    return `Error preparing transfer: ${error}`;
  }
}

/**
 * Gets the contract address for a token symbol on the current network.
 *
 * @param walletProvider - The wallet provider to get the network from.
 * @param args - The input arguments for the action.
 * @returns A message containing the token address or an error if not found.
 */
async function getTokenAddress(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof GetTokenAddressSchema>,
): Promise<string> {
  const network = walletProvider.getNetwork();
  const networkId = network.networkId ?? "";
  const networkTokens = TOKEN_ADDRESSES_BY_SYMBOLS[networkId as keyof typeof TOKEN_ADDRESSES_BY_SYMBOLS];
  const tokenAddress = networkTokens?.[args.symbol as keyof typeof networkTokens];

  if (tokenAddress) {
    return `Token address for ${args.symbol} on ${networkId}: ${tokenAddress}`;
  }

  // Get available token symbols for the current network
  const availableSymbols = networkTokens ? Object.keys(networkTokens) : [];
  const availableSymbolsText =
    availableSymbols.length > 0
      ? ` Available token symbols on ${networkId}: ${availableSymbols.join(", ")}`
      : ` No token symbols are configured for ${networkId}`;

  return `Error: Token symbol "${args.symbol}" not found on ${networkId}.${availableSymbolsText}`;
}

/**
 * Factory function to create ERC20 action provider.
 * Returns a single action provider with all ERC20 actions.
 *
 * @returns Action provider with ERC20 balance and transfer actions
 */
export const erc20ActionProvider = () => {
  const provider = customActionProvider<EvmWalletProvider>([
    {
      name: "get_erc20_token_address",
      description: `
      This tool will get the contract address for frequently used ERC20 tokens.
      Use this tool when you need to find the contract address for a known token symbol.
      `,
      schema: GetTokenAddressSchema,
      invoke: getTokenAddress,
    },
    {
      name: "get_erc20_balance",
      description: `
      This tool gets the balance of an ERC20 token for a specific wallet address.  
      Important notes:
      - The address parameter is typically the user's wallet address
      - Never assume token addresses, they must be provided as inputs
      `,
      schema: GetBalanceSchema,
      invoke: getBalance,
    },
    {
      name: "prepare_erc20_transfer",
      description: `
      This tool prepares an ERC20 token transfer transaction for the user to approve with their wallet.
      
      Important notes:
      - This does NOT execute the transaction - it only prepares it
      - The user must approve the transaction in their own wallet
      - Always verify the user has sufficient balance before preparing
      - Never assume token addresses, they must be provided as inputs
      `,
      schema: PrepareTransferSchema,
      invoke: prepareTransfer,
    },
  ]);

  return [provider];
};

