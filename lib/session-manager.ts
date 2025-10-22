/**
 * Session management for conversations and users
 */

import * as fs from "fs";
import type { MessageContext, GroupMember } from "@xmtp/agent-sdk";
import { IdentifierKind } from "@xmtp/agent-sdk";
import { STORAGE_DIR } from "./constants";

export interface UserSession {
  inboxId: string;
  ethereumAddress?: string;
  lastSeen?: Date;
}

export interface ConversationSession {
  conversationId: string;
  conversationType: "dm" | "group";
  participants: Array<{
    inboxId: string;
    ethereumAddress?: string;
  }>;
  lastActiveLedgerId?: string; // For groups
  groupName?: string; // For groups
  groupDescription?: string; // For groups
  groupImageUrl?: string; // For groups
  lastSeen: Date;
}

/**
 * Ensure local storage directory exists.
 */
export function ensureLocalStorage(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

/**
 * Save user session data to storage.
 */
export function saveUserSession(inboxId: string, data: UserSession): void {
  const localFilePath = `${STORAGE_DIR}/${inboxId}.json`;
  try {
    fs.writeFileSync(localFilePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Failed to save user session: ${error}`);
  }
}

/**
 * Get user session data from storage.
 */
export function getUserSession(inboxId: string): UserSession | null {
  const localFilePath = `${STORAGE_DIR}/${inboxId}.json`;
  try {
    if (fs.existsSync(localFilePath)) {
      return JSON.parse(fs.readFileSync(localFilePath, "utf8"));
    }
  } catch (error) {
    console.warn(`Could not read user session: ${error}`);
  }
  return null;
}

/**
 * Get conversation session data from storage.
 */
export function getConversationSession(
  conversationId: string,
  isGroup: boolean
): ConversationSession | null {
  const prefix = isGroup ? "group" : "dm";
  const localFilePath = `${STORAGE_DIR}/${prefix}_${conversationId}.json`;
  try {
    if (fs.existsSync(localFilePath)) {
      const data = JSON.parse(fs.readFileSync(localFilePath, "utf8"));
      // Convert lastSeen back to Date object
      if (data.lastSeen) {
        data.lastSeen = new Date(data.lastSeen);
      }
      return data;
    }
  } catch (error) {
    console.warn(`Could not read conversation session: ${error}`);
  }
  return null;
}

/**
 * Save conversation session data to storage.
 */
export function saveConversationSession(
  conversationId: string,
  isGroup: boolean,
  data: ConversationSession
): void {
  const prefix = isGroup ? "group" : "dm";
  const localFilePath = `${STORAGE_DIR}/${prefix}_${conversationId}.json`;
  try {
    fs.writeFileSync(localFilePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Failed to save conversation session: ${error}`);
  }
}

/**
 * Extract Ethereum address from a group member's account identifiers.
 */
function extractEthereumAddress(member: GroupMember): string | undefined {
  const ethIdentifier = member.accountIdentifiers.find(
    (id: any) => id.identifierKind === IdentifierKind.Ethereum
  );
  return ethIdentifier?.identifier;
}

/**
 * Extract all participants from conversation members.
 */
function extractParticipants(members: GroupMember[]): Array<{
  inboxId: string;
  ethereumAddress?: string;
}> {
  return members.map((member) => ({
    inboxId: member.inboxId,
    ethereumAddress: extractEthereumAddress(member),
  }));
}

/**
 * Initialize or refresh conversation session by fetching all members and metadata from XMTP.
 * This function should be called when a thread is first encountered in the current session.
 */
export async function initializeConversationSession(
  ctx: MessageContext,
  threadId: string,
  isGroup: boolean
): Promise<ConversationSession | null> {
  try {
    const conversationId = ctx.conversation.id;
    
    // Fetch all members
    const members = await ctx.conversation.members();
    const participants = extractParticipants(members);
    
    // Get group metadata if it's a group conversation
    let groupName: string | undefined;
    let groupDescription: string | undefined;
    let groupImageUrl: string | undefined;
    
    if (isGroup) {
      // Access group-specific properties
      const group = ctx.conversation as any; // Group type from SDK
      groupName = group.name || undefined;
      groupDescription = group.description || undefined;
      groupImageUrl = group.imageUrl || undefined;
    }
    
    // Create session object
    const session: ConversationSession = {
      conversationId,
      conversationType: isGroup ? "group" : "dm",
      participants,
      groupName,
      groupDescription,
      groupImageUrl,
      lastSeen: new Date(),
    };
    
    // Save session to storage
    saveConversationSession(threadId, isGroup, session);
    
    console.log(`📋 Initialized session for ${isGroup ? 'group' : 'DM'} ${threadId.slice(0, 8)}...`);
    console.log(`   Members: ${participants.length}`);
    if (isGroup && groupName) {
      console.log(`   Group name: ${groupName}`);
    }
    
    return session;
  } catch (error) {
    console.error("Error initializing conversation session:", error);
    return null;
  }
}

/**
 * Update session with new group members (after member addition).
 */
export async function updateSessionMembers(
  ctx: MessageContext,
  threadId: string
): Promise<void> {
  try {
    const session = getConversationSession(threadId, true);
    if (!session) {
      console.warn(`Cannot update members: session ${threadId} not found`);
      return;
    }
    
    // Refresh all members to get their Ethereum addresses
    const members = await ctx.conversation.members();
    session.participants = extractParticipants(members);
    session.lastSeen = new Date();
    
    saveConversationSession(threadId, true, session);
    console.log(`   Updated members for group ${threadId.slice(0, 8)}...`);
  } catch (error) {
    console.error("Error updating session members:", error);
  }
}

