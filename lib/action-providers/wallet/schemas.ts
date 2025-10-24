import { z } from "zod";

/**
 * Input schema for ETH balance check action.
 */
export const GetEthBalanceSchema = z
  .object({
    address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .describe("The wallet address to check ETH balance for (defaults to user's address if not provided)"),
  })
  .strip()
  .describe("Instructions for getting ETH balance for a specific address");

