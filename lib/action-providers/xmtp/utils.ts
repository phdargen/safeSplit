/**
 * XMTP helper utilities for action providers.
 * Provides unified access to XMTP client and group operations.
 */
import { IdentifierKind, Agent as XMTPAgent } from "@xmtp/agent-sdk";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Singleton XMTP client instance shared across action providers.
 */
let xmtpClient: Awaited<ReturnType<typeof XMTPAgent.createFromEnv>>['client'] | null = null;

/**
 * Get or create the XMTP client instance.
 * Lazy initialization - creates client on first use.
 */
export async function getXmtpClient(): Promise<Awaited<ReturnType<typeof XMTPAgent.createFromEnv>>['client']> {
  if (xmtpClient) {
    return xmtpClient;
  }

  try {
    const xmtpAgent = await XMTPAgent.createFromEnv({
      env: (process.env.XMTP_ENV as "local" | "dev" | "production") || "dev",
    });

    xmtpClient = xmtpAgent.client;
    return xmtpClient;
  } catch (error) {
    console.error("❌ Failed to create XMTP client:", error);
    throw new Error(`Failed to initialize XMTP client: ${error}`);
  }
}

/**
 * Group member information.
 */
export interface GroupMember {
  inboxId: string;
  address: string;
}

/**
 * Group metadata information.
 */
export interface GroupMetadata {
  id: string;
  name: string;
  createdAt: number;
  memberCount: number;
  description?: string;
}

/**
 * Get all members of a group with their Ethereum addresses.
 */
export async function getGroupMembers(
  groupId: string
): Promise<GroupMember[]> {
  try {
    const client = await getXmtpClient();
    
    // List all conversations and find the one matching groupId
    const conversations = await client.conversations.list();
    const group = conversations.find((c: typeof conversations[number]) => c.id === groupId);

    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }

    // Sync to get latest member data
    await group.sync();
    const members = await group.members();

    // Extract Ethereum addresses from account identifiers
    const participants: GroupMember[] = [];

    for (const member of members) {
      const ethIdentifier = member.accountIdentifiers.find(
        (id: { identifierKind: IdentifierKind; identifier?: string }) => id.identifierKind === IdentifierKind.Ethereum
      );

      if (ethIdentifier && ethIdentifier.identifier) {
        participants.push({
          inboxId: member.inboxId,
          address: ethIdentifier.identifier.toLowerCase(),
        });
      } else {
        console.warn(`⚠️  No Ethereum address found for member ${member.inboxId}`);
      }
    }

    return participants;
  } catch (error) {
    console.error(`❌ Error fetching group members for ${groupId}:`, error);
    throw error;
  }
}

/**
 * Get sender information (inboxId and address) from a group.
 */
export async function getSenderInfo(
  senderInboxId: string,
  groupId: string
): Promise<GroupMember> {
  try {
    const members = await getGroupMembers(groupId);
    const sender = members.find((m) => m.inboxId === senderInboxId);

    if (!sender) {
      throw new Error(
        `Sender ${senderInboxId} not found in group ${groupId}`
      );
    }

    return sender;
  } catch (error) {
    console.error(`❌ Error getting sender info for ${senderInboxId}:`, error);
    throw error;
  }
}

/**
 * Get comprehensive group information including members and metadata.
 */
export async function getGroupInfo(groupId: string): Promise<{
  metadata: GroupMetadata;
  members: GroupMember[];
}> {
  try {
    const client = await getXmtpClient();
    
    // List all conversations and find the one matching groupId
    const conversations = await client.conversations.list();
    const group = conversations.find((c: typeof conversations[number]) => c.id === groupId);

    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }

    // Sync to get latest data
    await group.sync();

    // Get members
    const members = await getGroupMembers(groupId);

    // Build metadata
    const metadata: GroupMetadata = {
      id: group.id,
      name: group.name || "Unnamed Group",
      createdAt: group.createdAt,
      memberCount: members.length,
      description: group.description,
    };

    return {
      metadata,
      members,
    };
  } catch (error) {
    console.error(`❌ Error fetching group info for ${groupId}:`, error);
    throw error;
  }
}

