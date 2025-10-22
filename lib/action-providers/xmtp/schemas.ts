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

