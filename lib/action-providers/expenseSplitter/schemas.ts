import { z } from "zod";

/**
 * Schema for creating a new expense tab.
 */
export const CreateTabSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID where this tab belongs"),
    tabName: z
      .string()
      .describe("Human-readable name for the tab (e.g., 'Weekend Trip', 'Monthly Dinners')"),
  })
  .strip()
  .describe("Instructions for creating a new expense tab in a group");

/**
 * Schema for listing all tabs in a group.
 */
export const ListTabsSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID to list tabs for"),
  })
  .strip()
  .describe("Instructions for listing all expense tabs in a group");

/**
 * Schema for adding an expense to a tab.
 */
export const AddExpenseSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID"),
    tabId: z
      .string()
      .describe("The tab ID to add the expense to"),
    amount: z
      .string()
      .describe("The amount of the expense (e.g., '10.5', '100')"),
    description: z
      .string()
      .describe("Description of what the expense was for (e.g., 'beer', 'dinner', 'hotel')"),
    payerAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/i, "Invalid Ethereum address format")
      .describe("Ethereum address of the person who paid for this expense. Can be any participant in the tab."),
    participantAddresses: z
      .array(z.string().regex(/^0x[a-fA-F0-9]{40}$/i, "Invalid Ethereum address format"))
      .optional()
      .describe("Optional array of Ethereum addresses for people sharing this expense. If not provided, defaults to all tab participants."),
  })
  .strip()
  .describe("Instructions for adding an expense to a tab");

/**
 * Schema for listing expenses in a tab.
 */
export const ListExpensesSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID"),
    tabId: z
      .string()
      .describe("The tab ID to list expenses from"),
  })
  .strip()
  .describe("Instructions for listing all expenses in a tab");

/**
 * Schema for getting balances in a tab.
 */
export const GetBalanceSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID"),
    tabId: z
      .string()
      .describe("The tab ID to calculate balances for"),
  })
  .strip()
  .describe("Instructions for calculating who owes what in a tab");

/**
 * Schema for deleting an expense.
 */
export const DeleteExpenseSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID"),
    tabId: z
      .string()
      .describe("The tab ID containing the expense"),
    expenseId: z
      .string()
      .describe("The ID of the expense to delete"),
  })
  .strip()
  .describe("Instructions for deleting an expense from a tab");

/**
 * Schema for settling expenses.
 */
export const SettleExpensesSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID"),
    tabId: z
      .string()
      .describe("The tab ID to settle"),
    tokenAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
      .optional()
      .describe("Token contract address for settlement (defaults to USDC for the current network)"),
  })
  .strip()
  .describe("Instructions for computing optimal settlements and preparing USDC transfer transactions");

