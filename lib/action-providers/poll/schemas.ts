import { z } from "zod";

/**
 * Schema for creating a new poll.
 */
export const CreatePollSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID where this poll will be created"),
    question: z
      .string()
      .describe("The poll question (e.g., 'Where should we go for dinner?')"),
    options: z
      .array(z.string())
      .min(2)
      .max(10)
      .describe("Array of poll options (2-10 options allowed)"),
    deadline: z
      .string()
      .optional()
      .default("24 hours")
      .describe("Deadline for voting in natural format (e.g., '2 hours', '3 days', '1 hour', '5 days'). Defaults to 24 hours if not specified."),
    creatorInboxId: z
      .string()
      .describe("The inbox ID of the person creating the poll (use senderInboxId from context)"),
    creatorAddress: z
      .string()
      .describe("The Ethereum address of the person creating the poll (use senderAddress from context)"),
  })
  .strip()
  .describe("Instructions for creating a new poll in a group");

/**
 * Schema for voting on a poll.
 */
export const VoteOnPollSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID"),
    pollId: z
      .string()
      .describe("The poll ID to vote on"),
    optionIndex: z
      .number()
      .int()
      .min(0)
      .describe("The index of the option to vote for (0-based)"),
    voterInboxId: z
      .string()
      .describe("The inbox ID of the person voting (use senderInboxId from context)"),
    voterAddress: z
      .string()
      .describe("The Ethereum address of the person voting (use senderAddress from context)"),
  })
  .strip()
  .describe("Instructions for voting on a poll");

/**
 * Schema for getting poll results.
 */
export const GetPollResultsSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID"),
    pollId: z
      .string()
      .describe("The poll ID to get results for"),
  })
  .strip()
  .describe("Instructions for getting poll results");

