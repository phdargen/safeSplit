import { Hex, erc20Abi, formatUnits } from "viem";
import { EvmWalletProvider } from "@coinbase/agentkit";

/**
 * Interface for token details
 */
export interface TokenDetails {
  name: string;
  decimals: number;
  balance: bigint;
  formattedBalance: string;
}

/**
 * Gets the details of an ERC20 token including name, decimals, and balance.
 *
 * @param walletProvider - The wallet provider to use for the multicall.
 * @param contractAddress - The contract address of the ERC20 token.
 * @param address - The address to check the balance for. If not provided, uses the wallet's address.
 * @returns A promise that resolves to TokenDetails or null if there's an error.
 */
export async function getTokenDetails(
  walletProvider: EvmWalletProvider,
  contractAddress: string,
  address?: string,
): Promise<TokenDetails | null> {
  try {
    const results = await walletProvider.getPublicClient().multicall({
      contracts: [
        {
          address: contractAddress as Hex,
          abi: erc20Abi,
          functionName: "name",
          args: [],
        },
        {
          address: contractAddress as Hex,
          abi: erc20Abi,
          functionName: "decimals",
          args: [],
        },
        {
          address: contractAddress as Hex,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [(address || walletProvider.getAddress()) as Hex],
        },
      ],
    });

    const name = results[0]?.result as string | undefined;
    const decimals = results[1]?.result as number | undefined;
    const balance = results[2]?.result as bigint | undefined;

    if (
      balance === undefined ||
      decimals === undefined ||
      name === undefined
    ) {
      return null;
    }

    const formattedBalance = formatUnits(balance, decimals);

    return {
      name,
      decimals,
      balance,
      formattedBalance,
    };
  } catch {
    return null;
  }
}
