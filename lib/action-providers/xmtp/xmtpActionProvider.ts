import { z } from "zod";
import { customActionProvider, EvmWalletProvider } from "@coinbase/agentkit";
import { ListGroupInfoSchema } from "./schemas";
import { getGroupInfo } from "./utils";

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
    
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      output += `${i + 1}. Address: ${member.address}\n`;
      output += `   Inbox ID: ${member.inboxId}\n\n`;
    }

    return output.trim();
  } catch (error) {
    return `Error retrieving group information: ${error}`;
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
      
      It takes the following inputs:
      - groupId: The XMTP group ID to retrieve information for
      
      Returns:
      - Group metadata (ID, name, creation date, member count, description)
      - Complete list of all group members with their Ethereum addresses and inbox IDs
      
      Use this when:
      - Users want to see who is in a group
      - Users need to know member addresses for other operations
      - Users ask about group details or information
      `,
      schema: ListGroupInfoSchema,
      invoke: listGroupInfo,
    },
  ]);

  return [provider];
};

