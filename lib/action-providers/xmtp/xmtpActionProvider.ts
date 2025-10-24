import { z } from "zod";
import { customActionProvider, EvmWalletProvider } from "@coinbase/agentkit";
import { ListGroupInfoSchema, CreateGroupSchema } from "./schemas";
import { getGroupInfo, createGroup } from "./utils";
import { resolveAddressToDisplayName, resolveIdentifierToAddress } from "../../identity-resolver";

/**
 * List comprehensive information about an XMTP group.
 * Includes metadata (name, created date) and all members with their addresses.
 */
async function listGroupInfo(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof ListGroupInfoSchema>
): Promise<string> {
  try {
    const { metadata, members } = await getGroupInfo(args.groupId);

    const createdDate = new Date(metadata.createdAt).toLocaleString();
    
    let output = `📋 Group Information\n\n`;
    output += `🆔 Group ID: ${metadata.id}\n`;
    output += `📛 Name: ${metadata.name}\n`;
    output += `📅 Created: ${createdDate}\n`;
    output += `👥 Members: ${metadata.memberCount}\n`;
    
    if (metadata.description) {
      output += `📝 Description: ${metadata.description}\n`;
    }
    
    output += `\n👥 Group Members:\n\n`;
    
    // Resolve display names for all members
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const displayName = await resolveAddressToDisplayName(member.address);
      output += `${i + 1}. ${displayName}\n`;
      output += `   Inbox ID: ${member.inboxId}\n\n`;
    }

    return output.trim();
  } catch (error) {
    return `Error retrieving group information: ${error}`;
  }
}

/**
 * Create a new XMTP group with specified members.
 * Automatically adds the agent and sender to the group.
 */
async function createXmtpGroup(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof CreateGroupSchema>
): Promise<string> {
  try {
    // Resolve all member identifiers to addresses
    const resolvedAddresses: string[] = [];
    const failedResolutions: string[] = [];
    
    for (const identifier of args.memberAddresses) {
      try {
        const address = await resolveIdentifierToAddress(identifier);
        resolvedAddresses.push(address);
      } catch (error) {
        failedResolutions.push(identifier);
      }
    }

    // Also add the sender address
    try {
      const senderAddress = await resolveIdentifierToAddress(args.senderAddress);
      if (!resolvedAddresses.includes(senderAddress)) {
        resolvedAddresses.push(senderAddress);
      }
    } catch (error) {
      return JSON.stringify({
        success: false,
        message: `Could not resolve sender address "${args.senderAddress}": ${error}`,
      });
    }

    // Report resolution failures if any
    if (failedResolutions.length > 0) {
      return JSON.stringify({
        success: false,
        message: `Could not resolve the following identifiers: ${failedResolutions.join(", ")}`,
      });
    }

    // Create the group
    const result = await createGroup(resolvedAddresses, {
      groupName: args.groupName,
      description: args.description,
      imageUrl: args.imageUrl,
    });

    // Get display names for all members
    const memberDisplayNames = await Promise.all(
      resolvedAddresses.map(addr => resolveAddressToDisplayName(addr))
    );

    return JSON.stringify({
      success: true,
      data: {
        groupId: result.groupId,
        groupName: result.groupName,
        memberCount: result.memberCount,
        members: memberDisplayNames,
      },
      message: `Created group "${result.groupName}" with ${result.memberCount} members (including agent)`,
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      message: `Error creating group: ${error}`,
    });
  }
}

/**
 * Factory function to create XMTP action provider.
 * Returns a single action provider with all XMTP-related actions.
 */
export const xmtpActionProvider = () => {
  const provider = customActionProvider<EvmWalletProvider>([
    {
      name: "list_group_info",
      description: `
      This tool retrieves comprehensive information about an XMTP group.
      
      Use this when:
      - Users want to see who is in a group
      - Users need to know member addresses for other operations
      - Users ask about group details or information
      `,
      schema: ListGroupInfoSchema,
      invoke: listGroupInfo,
    },
    {
      name: "create_xmtp_group",
      description: `
      This tool creates a new XMTP group chat with specified members.      
      The agent and sender are automatically added to the group.

      Use this when:
      - Users want to create a new group chat
      - Users want to start a conversation with multiple people
      - Users ask to "create a group" or "make a group chat"
      `,
      schema: CreateGroupSchema,
      invoke: createXmtpGroup,
    },
  ]);

  return [provider];
};

