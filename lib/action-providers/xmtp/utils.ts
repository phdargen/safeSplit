/**
 * XMTP helper utilities for action providers.
 * Provides unified access to XMTP client and group operations.
 */
import { IdentifierKind, Agent as XMTPAgent } from "@xmtp/agent-sdk";
import { ContentTypeMarkdown } from "@xmtp/content-type-markdown";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Singleton XMTP agent and client instances shared across action providers.
 */
let xmtpAgent: Awaited<ReturnType<typeof XMTPAgent.createFromEnv>> | null = null;
let xmtpClient: Awaited<ReturnType<typeof XMTPAgent.createFromEnv>>['client'] | null = null;

/**
 * Set the shared XMTP agent instance.
 * Should be called once at startup from the main chatbot to ensure
 * all action providers use the same agent instance.
 */
export function setSharedXmtpAgent(agent: Awaited<ReturnType<typeof XMTPAgent.createFromEnv>>): void {
  xmtpAgent = agent;
  xmtpClient = agent.client;
  console.log("✅ Shared XMTP agent set for action providers");
}

/**
 * Get or create the XMTP client instance.
 * Lazy initialization - creates client on first use.
 */
export async function getXmtpClient(): Promise<Awaited<ReturnType<typeof XMTPAgent.createFromEnv>>['client']> {
  if (xmtpClient) {
    return xmtpClient;
  }

  throw new Error("XMTP agent not initialized. Call setSharedXmtpAgent() first.");
}

/**
 * Get or create the XMTP agent instance.
 * Lazy initialization - creates agent on first use.
 */
export async function getXmtpAgent(): Promise<Awaited<ReturnType<typeof XMTPAgent.createFromEnv>>> {
  if (xmtpAgent) {
    return xmtpAgent;
  }

  throw new Error("XMTP agent not initialized. Call setSharedXmtpAgent() first.");
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

/**
 * Options for creating a new group.
 */
export interface CreateGroupOptions {
  groupName: string;
  description?: string;
  imageUrl?: string;
}

/**
 * Create a new XMTP group with specified addresses.
 * The agent is automatically added as a member.
 */
export async function createGroup(
  memberAddresses: string[],
  options: CreateGroupOptions
): Promise<{
  groupId: string;
  groupName: string;
  memberCount: number;
}> {
  try {
    const agent = await getXmtpAgent();
    
    // Create the group with addresses - agent is automatically added
    const group = await agent.createGroupWithAddresses(
      memberAddresses as `0x${string}`[],
    );

    await group.updateName(options.groupName);
    if(options.description) await group.updateDescription(options.description);
    if(options.imageUrl) await group.updateImageUrl(options.imageUrl);

    // Sync to get latest data
    await group.sync();
    console.log(`✅ Created group "${group.groupName}" with ID: ${group.id}`);
   
    // Send welcome message
    const groupName = group.name || options.groupName;
    const welcomeText = `Hi **${groupName}** 👋

I am **Capy**, your friendly AI companion keeping tab of your expenses!

#### What I can do

- **Create poll** - Make group decisions together
- **Create tab** - Track and split shared expenses
- **Onchain transactions** - Prepare USDC transfers for your approval

---

💡 Type */info* or just tag me (*@capy*) in a message to get started!`;

    await group.send(welcomeText, ContentTypeMarkdown);
    await group.sync();

    return {
      groupId: group.id,
      groupName: group.name || options.groupName,
      memberCount: memberAddresses.length + 1, // +1 for agent
    };
  } catch (error) {
    console.error(`❌ Error creating group:`, error);
    throw error;
  }
}

