/**
 * User session management
 */

import * as fs from "fs";
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

