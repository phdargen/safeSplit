import { z } from "zod";

/**
 * Schema for creating a new expense ledger.
 */
export const CreateLedgerSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID where this ledger belongs"),
    ledgerName: z
      .string()
      .describe("Human-readable name for the ledger (e.g., 'Weekend Trip', 'Monthly Dinners')"),
    currency: z
      .string()
      .optional()
      .default("USDC")
      .describe("Currency for this ledger (default: USDC)"),
  })
  .strip()
  .describe("Instructions for creating a new expense ledger in a group");

/**
 * Schema for listing all ledgers in a group.
 */
export const ListLedgersSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID to list ledgers for"),
  })
  .strip()
  .describe("Instructions for listing all expense ledgers in a group");

/**
 * Schema for adding an expense to a ledger.
 */
export const AddExpenseSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID"),
    ledgerId: z
      .string()
      .describe("The ledger ID to add the expense to"),
    amount: z
      .string()
      .describe("The amount of the expense (e.g., '10.5', '100')"),
    description: z
      .string()
      .describe("Description of what the expense was for (e.g., 'beer', 'dinner', 'hotel')"),
    payerInboxId: z
      .string()
      .describe("Inbox ID of the person who paid (defaults to message sender if not specified)"),
    payerAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .describe("Ethereum address of the person who paid"),
    participantInboxIds: z
      .array(z.string())
      .optional()
      .describe("Array of inbox IDs of people sharing this expense (defaults to all group members if not specified)"),
    weights: z
      .array(z.number().positive())
      .optional()
      .describe("Optional weights for proportional splitting (e.g., [2, 1, 1] for 2:1:1 split). Must match participantInboxIds length if provided"),
  })
  .strip()
  .describe("Instructions for adding an expense to a ledger");

/**
 * Schema for listing expenses in a ledger.
 */
export const ListExpensesSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID"),
    ledgerId: z
      .string()
      .describe("The ledger ID to list expenses from"),
  })
  .strip()
  .describe("Instructions for listing all expenses in a ledger");

/**
 * Schema for getting balances in a ledger.
 */
export const GetBalanceSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID"),
    ledgerId: z
      .string()
      .describe("The ledger ID to calculate balances for"),
  })
  .strip()
  .describe("Instructions for calculating who owes what in a ledger");

/**
 * Schema for deleting an expense.
 */
export const DeleteExpenseSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID"),
    ledgerId: z
      .string()
      .describe("The ledger ID containing the expense"),
    expenseId: z
      .string()
      .describe("The ID of the expense to delete"),
  })
  .strip()
  .describe("Instructions for deleting an expense from a ledger");

/**
 * Schema for settling expenses.
 */
export const SettleExpensesSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID"),
    ledgerId: z
      .string()
      .describe("The ledger ID to settle"),
    tokenAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .optional()
      .describe("Token contract address for settlement (defaults to USDC for the current network)"),
  })
  .strip()
  .describe("Instructions for computing optimal settlements and preparing USDC transfer transactions");

