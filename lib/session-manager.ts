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

