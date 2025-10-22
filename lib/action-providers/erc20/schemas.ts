import { z } from "zod";

/**
 * Input schema for balance check action.
 */
export const GetBalanceSchema = z
  .object({
    tokenAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .describe("The contract address of the ERC20 token"),
    address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .describe("The user's wallet address to check balance for"),
  })
  .strip()
  .describe("Instructions for getting wallet balance for a specific address");

/**
 * Input schema for transfer preparation action.
 */
export const PrepareTransferSchema = z
  .object({
    amount: z
      .string()
      .describe("The amount to transfer in whole units (e.g. 1.5 USDC)"),
    tokenAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .describe("The contract address of the token to transfer"),
    destinationAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .describe("The destination address to transfer the funds to"),
    userAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .describe("The user's wallet address that will sign and execute the transaction"),
  })
  .strip()
  .describe("Instructions for preparing a transfer transaction for user approval");

