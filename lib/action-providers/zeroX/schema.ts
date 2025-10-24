import { z } from "zod";

/**
 * Input schema for getting a swap price.
 */
export const GetSwapPriceSchema = z
  .object({
    sellToken: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .describe("The token contract address to sell"),
    buyToken: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .describe("The token contract address to buy"),
    sellAmount: z
      .string()
      .describe("The amount of sellToken to sell in whole units (e.g., 1.5 WETH, 10 USDC)"),
    slippageBps: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .optional()
      .default(100)
      .describe("The maximum acceptable slippage in basis points (0-10000, default: 100)")
  })
  .strip()
  .describe("Get a price quote for swapping one token for another");

/**
 * Input schema for preparing a swap.
 */
export const PrepareSwapSchema = z
  .object({
    sellToken: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .describe("The token contract address to sell"),
    buyToken: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .describe("The token contract address to buy"),
    sellAmount: z
      .string()
      .describe("The amount of sellToken to sell in whole units (e.g., 1.5 WETH, 10 USDC)"),
    userAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .describe("The user's wallet address that will sign and execute the transaction"),
    slippageBps: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .optional()
      .default(100)
      .describe("The maximum acceptable slippage in basis points (0-10000, default: 100)")
  })
  .strip()
  .describe("Prepare a swap transaction between two tokens for user approval");