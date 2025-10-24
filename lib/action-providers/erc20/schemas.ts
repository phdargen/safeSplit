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
      .describe("The destination to transfer funds to (Ethereum address, ENS name, or Basename). Names without .eth suffix automatically get .base.eth appended"),
    userAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .describe("The user's wallet address that will sign and execute the transaction"),
  })
  .strip()
  .describe("Instructions for preparing a transfer transaction for user approval");

/**
 * Input schema for getting token address by symbol.
 */
export const GetTokenAddressSchema = z
  .object({
    symbol: z
      .string()
      .describe("The token symbol (e.g. USDC, EURC, CBBTC)"),
  })
  .strip()
  .describe("Instructions for getting the contract address of a token by its symbol");

