import { z } from "zod";
import { customActionProvider, EvmWalletProvider } from "@coinbase/agentkit";
import { GetEthBalanceSchema } from "./schemas";
import { formatEther, Hex } from "viem";

/**
 * Gets the ETH balance for a wallet address.
 *
 * @param walletProvider - The wallet provider (used for RPC access).
 * @param args - The input arguments for the action.
 * @returns A message containing the ETH balance.
 */
async function getEthBalance(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof GetEthBalanceSchema>,
): Promise<string> {
  try {
    const address = args.address;

    // Get balance using the public client
    const balance = await walletProvider.getPublicClient().getBalance({
      address: address as Hex,
    });

    // Format balance from wei to ETH
    const formattedBalance = formatEther(balance);

    return `ETH balance at address ${address} is ${formattedBalance} ETH`;
  } catch (error) {
    return `Error: Could not fetch ETH balance for ${args.address}: ${error}`;
  }
}

/**
 * Factory function to create wallet action provider.
 * Returns a single action provider with wallet-related actions.
 *
 * @returns Action provider with ETH balance action
 */
export const walletActionProvider = () => {
  const provider = customActionProvider<EvmWalletProvider>([
    {
      name: "get_eth_balance",
      description: `
      This tool gets the ETH (native currency) balance for a specific wallet address.
      
      Important notes:
      - The address parameter should typically be the user's wallet address
      - Returns the balance in ETH (not wei)
      `,
      schema: GetEthBalanceSchema,
      invoke: getEthBalance,
    },
  ]);

  return [provider];
};

