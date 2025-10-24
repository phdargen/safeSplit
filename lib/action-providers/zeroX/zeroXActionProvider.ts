import { z } from "zod";
import { customActionProvider, EvmWalletProvider } from "@coinbase/agentkit";
import { GetSwapPriceSchema, PrepareSwapSchema } from "./schema";
import { SwapTransactionPrepared } from "./types";
import { getTokenDetails, PERMIT2_ADDRESS } from "./utils";
import {
  erc20Abi,
  formatUnits,
  parseUnits,
  maxUint256,
  encodeFunctionData,
  size,
  concat,
  Hex,
  numberToHex,
} from "viem";

/**
 * Configuration for the zeroX action provider.
 */
export interface ZeroXActionProviderConfig {
  /**
   * The API key to use for 0x API requests.
   */
  apiKey?: string;
}

/**
 * Gets a price quote for swapping one token for another.
 *
 * @param walletProvider - The wallet provider (used only for RPC access).
 * @param args - The input arguments for the action.
 * @param apiKey - The 0x API key.
 * @returns A JSON string containing the price quote.
 */
async function getSwapPrice(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof GetSwapPriceSchema>,
  apiKey: string,
): Promise<string> {
  const chainId = walletProvider.getNetwork().chainId;
  if (!chainId) {
    return JSON.stringify({
      success: false,
      error: "Chain ID not available from wallet provider",
    });
  }

  try {
    // Get token details
    const {
      fromTokenDecimals: sellTokenDecimals,
      toTokenDecimals: buyTokenDecimals,
      fromTokenName: sellTokenName,
      toTokenName: buyTokenName,
    } = await getTokenDetails(walletProvider, args.sellToken, args.buyToken);

    // Convert sell amount to base units
    const sellAmount = parseUnits(args.sellAmount, sellTokenDecimals).toString();

    // Create URL for the price API request
    const url = new URL("https://api.0x.org/swap/permit2/price");
    url.searchParams.append("chainId", chainId.toString());
    url.searchParams.append("sellToken", args.sellToken);
    url.searchParams.append("buyToken", args.buyToken);
    url.searchParams.append("sellAmount", sellAmount);
    url.searchParams.append("taker", walletProvider.getAddress());
    url.searchParams.append("slippageBps", args.slippageBps.toString());
    if (process.env.SWAP_FEE_RECIPIENT && process.env.SWAP_FEE_BPS) {
      url.searchParams.append("swapFeeRecipient", process.env.SWAP_FEE_RECIPIENT);
      url.searchParams.append("swapFeeBps", process.env.SWAP_FEE_BPS.toString());
      url.searchParams.append("swapFeeToken", args.sellToken);
    }

    // Make the request
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "0x-api-key": apiKey,
        "0x-version": "v2",
      },
    }) as Response;

    if (!(response as any).ok) {
      const errorText = await (response as any).text();
      return JSON.stringify({
        success: false,
        error: `Error fetching swap price: ${(response as any).status} ${(response as any).statusText} - ${errorText}`,
      });
    }

    const data = await (response as any).json();

    // Format the response
    const formattedResponse = {
      success: true,
      sellAmount: formatUnits(BigInt(sellAmount), sellTokenDecimals),
      sellTokenName: sellTokenName,
      sellToken: args.sellToken,
      buyAmount: formatUnits(data.buyAmount, buyTokenDecimals),
      minBuyAmount: data.minBuyAmount ? formatUnits(data.minBuyAmount, buyTokenDecimals) : null,
      buyTokenName: buyTokenName,
      buyToken: args.buyToken,
      slippageBps: args.slippageBps,
      liquidityAvailable: data.liquidityAvailable,
      balanceEnough: data.issues?.balance === null,
      priceOfBuyTokenInSellToken: (
        Number(formatUnits(BigInt(sellAmount), sellTokenDecimals)) /
        Number(formatUnits(data.buyAmount, buyTokenDecimals))
      ).toString(),
      priceOfSellTokenInBuyToken: (
        Number(formatUnits(data.buyAmount, buyTokenDecimals)) /
        Number(formatUnits(BigInt(sellAmount), sellTokenDecimals))
      ).toString(),
    };

    return JSON.stringify(formattedResponse);
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Error fetching swap price: ${error}`,
    });
  }
}

/**
 * Prepares a token swap transaction for user approval.
 * Returns a JSON string with transaction data that must be parsed and converted
 * to WalletSendCalls format by the chatbot.
 *
 * @param walletProvider - The wallet provider (used for RPC access and signing permit2).
 * @param args - The input arguments for the action.
 * @param apiKey - The 0x API key.
 * @returns A JSON string containing the prepared transaction data.
 */
async function prepareSwap(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof PrepareSwapSchema>,
  apiKey: string,
): Promise<string> {
  const chainId = walletProvider.getNetwork().chainId;
  if (!chainId) {
    return `Error: Chain ID not available from wallet provider`;
  }

  try {
    // Get token details
    const {
      fromTokenDecimals: sellTokenDecimals,
      toTokenDecimals: buyTokenDecimals,
      fromTokenName: sellTokenName,
      toTokenName: buyTokenName,
    } = await getTokenDetails(walletProvider, args.sellToken, args.buyToken);

    // Convert sell amount to base units
    const sellAmount = parseUnits(args.sellAmount, sellTokenDecimals).toString();

    // Fetch price quote first
    const priceUrl = new URL("https://api.0x.org/swap/permit2/price");
    priceUrl.searchParams.append("chainId", chainId.toString());
    priceUrl.searchParams.append("sellToken", args.sellToken);
    priceUrl.searchParams.append("buyToken", args.buyToken);
    priceUrl.searchParams.append("sellAmount", sellAmount);
    priceUrl.searchParams.append("taker", args.userAddress);
    priceUrl.searchParams.append("slippageBps", args.slippageBps.toString());
    if (process.env.SWAP_FEE_RECIPIENT && process.env.SWAP_FEE_BPS) {
      priceUrl.searchParams.append("swapFeeRecipient", process.env.SWAP_FEE_RECIPIENT);
      priceUrl.searchParams.append("swapFeeBps", process.env.SWAP_FEE_BPS.toString());
      priceUrl.searchParams.append("swapFeeToken", args.sellToken);
    }

    const priceResponse = await fetch(priceUrl.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "0x-api-key": apiKey,
        "0x-version": "v2",
      },
    }) as Response;
    console.log("priceResponse", priceResponse);

    if (!(priceResponse as any).ok) {
      const errorText = await (priceResponse as any).text();
      return `Error: Failed to fetch swap price: ${(priceResponse as any).status} ${(priceResponse as any).statusText} - ${errorText}`;
    }

    const priceData = await (priceResponse as any).json();
    console.log("💰 Price data:", JSON.stringify(priceData, null, 2));

    // Check if liquidity is available
    if (priceData.liquidityAvailable === false) {
      return "Error: No liquidity available for this swap.";
    }

    // Check if balance of sell token is enough
    if (priceData.issues?.balance) {
      return `Error: Insufficient balance of sell token ${priceData.issues.balance.token}. Requested to swap ${priceData.issues.balance.expected}, but balance is only ${priceData.issues.balance.actual}.`;
    }

    // Prepare the calls and metadata arrays
    const calls: Array<{
      to: string;
      data: string;
      value: string;
      gas?: string;
    }> = [];
    
    const metadata: Array<{
      description: string;
      transactionType: string;
      sellToken?: string;
      sellTokenName?: string;
      sellAmount?: string;
      buyToken?: string;
      buyTokenName?: string;
      buyAmount?: string;
      minBuyAmount?: string;
      slippageBps?: string;
    }> = [];

    // Check if permit2 approval is needed for ERC20 tokens
    let needsApproval = false;
    if (priceData.issues?.allowance) {
      needsApproval = true;
      const approvalData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [PERMIT2_ADDRESS, maxUint256],
      });

      calls.push({
        to: args.sellToken,
        data: approvalData,
        value: "0",
      });
      
      metadata.push({
        description: `Approve ${sellTokenName} for swapping`,
        transactionType: "approval",
        sellToken: args.sellToken,
        sellTokenName,
      });
    }

    // Fetch the swap quote
    const quoteUrl = new URL("https://api.0x.org/swap/permit2/quote");
    quoteUrl.searchParams.append("chainId", chainId.toString());
    quoteUrl.searchParams.append("sellToken", args.sellToken);
    quoteUrl.searchParams.append("buyToken", args.buyToken);
    quoteUrl.searchParams.append("sellAmount", sellAmount);
    quoteUrl.searchParams.append("taker", args.userAddress);
    quoteUrl.searchParams.append("slippageBps", args.slippageBps.toString());
    if (process.env.SWAP_FEE_RECIPIENT && process.env.SWAP_FEE_BPS) {
      quoteUrl.searchParams.append("swapFeeRecipient", process.env.SWAP_FEE_RECIPIENT);
      quoteUrl.searchParams.append("swapFeeBps", process.env.SWAP_FEE_BPS.toString());
      quoteUrl.searchParams.append("swapFeeToken", args.sellToken);
    }

    const quoteResponse = await fetch(quoteUrl.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "0x-api-key": apiKey,
        "0x-version": "v2",
      },
    }) as Response;
    console.log("quoteResponse", quoteResponse);

    if (!(quoteResponse as any).ok) {
      const errorText = await (quoteResponse as any).text();
      return `Error: Failed to fetch swap quote: ${(quoteResponse as any).status} ${(quoteResponse as any).statusText} - ${errorText}`;
    }

    const quoteData = await (quoteResponse as any).json();
    console.log("📝 Quote data:", JSON.stringify(quoteData, null, 2));

    // Sign Permit2.eip712 if required
    let transactionData = quoteData.transaction.data as Hex;
    if (quoteData.permit2?.eip712) {
      try {
        const typedData = {
          domain: quoteData.permit2.eip712.domain,
          types: quoteData.permit2.eip712.types,
          primaryType: quoteData.permit2.eip712.primaryType,
          message: quoteData.permit2.eip712.message,
        } as const;

        const signature = await walletProvider.signTypedData(typedData);

        // Append sig length and sig data to transaction.data
        const signatureLengthInHex = numberToHex(size(signature), {
          signed: false,
          size: 32,
        });

        transactionData = concat([transactionData, signatureLengthInHex as Hex, signature]);
      } catch (error) {
        return `Error: Failed to sign permit2 message: ${error}`;
      }
    }

    // Add the swap transaction
    calls.push({
      to: quoteData.transaction.to,
      data: transactionData,
      value: quoteData.transaction.value || "0",
      //...(quoteData.transaction.gas ? { gas: quoteData.transaction.gas } : {}),
    });
    
    // Add swap metadata
    const buyAmountFormatted = formatUnits(quoteData.buyAmount, buyTokenDecimals);
    const minBuyAmountFormatted = quoteData.minBuyAmount
      ? formatUnits(quoteData.minBuyAmount, buyTokenDecimals)
      : undefined;
    
    metadata.push({
      description: `Swap ${args.sellAmount} ${sellTokenName} for ${buyAmountFormatted} ${buyTokenName}`,
      transactionType: "swap",
      sellToken: args.sellToken,
      sellTokenName,
      sellAmount: args.sellAmount,
      buyToken: args.buyToken,
      buyTokenName,
      buyAmount: buyAmountFormatted,
      minBuyAmount: minBuyAmountFormatted,
      slippageBps: args.slippageBps.toString(),
    });

    console.log("🔧 Prepared calls:", JSON.stringify(calls, null, 2));
    console.log("📊 Transaction details:", {
      to: quoteData.transaction.to,
      value: quoteData.transaction.value || "0",
      dataLength: transactionData.length,
      needsApproval,
    });

    // Return structured response
    const description = `Swap ${args.sellAmount} ${sellTokenName} for ${buyAmountFormatted} ${buyTokenName}${needsApproval ? " (includes approval)" : ""}`;
    const response: SwapTransactionPrepared = {
      type: "SWAP_TRANSACTION_PREPARED",
      description,
      calls,
      metadata,
    };

    console.log("✅ Final response to be returned:", JSON.stringify(response, null, 2));

    return JSON.stringify(response);
  } catch (error) {
    return `Error preparing swap: ${error}`;
  }
}

/**
 * Factory function to create zeroX action provider.
 * Returns a single action provider with all 0x swap actions.
 *
 * @param config - Optional configuration including the 0x API key.
 * @returns Action provider with 0x swap price and prepare swap actions.
 */
export const zeroXActionProvider = (config?: ZeroXActionProviderConfig) => {
  const apiKey = config?.apiKey || process.env.ZEROX_API_KEY;
  if (!apiKey) {
    throw new Error("0x API key not provided in config or ZEROX_API_KEY environment variable.");
  }

  const provider = customActionProvider<EvmWalletProvider>([
    // {
    //   name: "get_swap_price_quote_from_0x",
    //   description: `
    //   This tool fetches a price quote for swapping between two tokens using the 0x API.
      
    //   It takes the following inputs:
    //   - sellToken: The contract address of the token to sell
    //   - buyToken: The contract address of the token to buy
    //   - sellAmount: The amount of sellToken to swap in whole units (e.g. 1 ETH or 10 USDC)
    //   - slippageBps: (Optional) Maximum allowed slippage in basis points (100 = 1%)
    //   - swapFeeRecipient: (Optional) The wallet address to receive affiliate trading fees
    //   - swapFeeBps: The amount in basis points (0-1000) to charge as affiliate fees (defaults to 100 = 1%), only used if swapFeeRecipient is provided
      
    //   Important notes:
    //   - The contract address for native ETH is "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    //   - This only fetches a price quote and does not execute a swap
    //   - Supported on all EVM networks compatible with 0x API
    //   - Use sellToken units exactly as provided, do not convert to wei or any other units
    //   - Never assume token addresses, they must be provided as inputs
    //   `,
    //   schema: GetSwapPriceSchema,
    //   invoke: async (walletProvider: EvmWalletProvider, args: z.infer<typeof GetSwapPriceSchema>) =>
    //     getSwapPrice(walletProvider, args, apiKey),
    // },
    {
      name: "prepare_swap_on_0x",
      description: `
      This tool prepares a token swap transaction for the user to approve with their wallet.
      
      Important notes:
      - The user must approve the transaction in their own wallet
      - If needed, it will prepare an approval transaction for the permit2 contract
      - The contract address for native ETH is "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      - Use sellToken units exactly as provided, do not convert to wei or any other units
      - Never assume token addresses, they must be provided as inputs

      Critical:
      - Message to user output format: Only reply with one brief sentence confirming the swap preparation.
      `,
      schema: PrepareSwapSchema,
      invoke: async (walletProvider: EvmWalletProvider, args: z.infer<typeof PrepareSwapSchema>) =>
        prepareSwap(walletProvider, args, apiKey),
    },
  ]);

  return [provider];
};

