import { z } from "zod";

/**
 * Schema for listing group information (members and metadata).
 */
export const ListGroupInfoSchema = z
  .object({
    groupId: z
      .string()
      .describe("The XMTP group ID to retrieve information for"),
  })
  .strip()
  .describe("Instructions for retrieving group information including members and metadata");

/**
 * Schema for creating a new XMTP group.
 */
export const CreateGroupSchema = z
  .object({
    groupName: z
      .string()
      .describe("The name of the group (required)"),
    memberAddresses: z
      .array(z.string())
      .describe("Array of identifiers (Ethereum addresses, ENS names, or Basenames) for group members. Names without .eth suffix automatically get .base.eth appended"),
    senderAddress: z
      .string()
      .describe("Ethereum address of the message sender (will be automatically added to the group)"),
    description: z
      .string()
      .optional()
      .describe("Optional description of the group"),
    imageUrl: z
      .string()
      .optional()
      .describe("Optional URL pointing to an image for the group"),
  })
  .strip()
  .describe("Instructions for creating a new XMTP group");

