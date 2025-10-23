/**
 * Redis storage operations for expense splitter.
 * Uses Upstash Redis for serverless-friendly persistence.
 */
import { Redis } from "@upstash/redis";
import * as dotenv from "dotenv";
import { ExpenseTab, Expense } from "./types";

dotenv.config();

// Validate environment variables
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.warn(
    "⚠️  Warning: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN not set. " +
    "Expense splitter will not persist data."
  );
}

/**
 * Singleton Redis client instance.
 */
export const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

/**
 * Generate Redis key for a tab.
 */
function getTabKey(groupId: string, tabId: string): string {
  return `expenseSplitter:group:${groupId}:tab:${tabId}`;
}

/**
 * Generate Redis key for the list of tab IDs in a group.
 */
function getTabsListKey(groupId: string): string {
  return `expenseSplitter:group:${groupId}:tabs`;
}

/**
 * Create a new expense tab.
 */
export async function createTab(
  groupId: string,
  tabId: string,
  tabName: string,
  currency: string = "USDC",
  participants: Array<{ inboxId: string; address: string }> = []
): Promise<ExpenseTab> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const tab: ExpenseTab = {
    id: tabId,
    name: tabName,
    groupId,
    participants,
    expenses: [],
    createdAt: Date.now(),
    currency,
  };

  const tabKey = getTabKey(groupId, tabId);
  const tabsListKey = getTabsListKey(groupId);

  // Store the tab (Upstash Redis handles JSON serialization automatically)
  await redis.set(tabKey, tab);

  // Add tab ID to the group's tab list
  await redis.sadd(tabsListKey, tabId);

  return tab;
}

/**
 * Get a specific tab by ID.
 */
export async function getTab(
  groupId: string,
  tabId: string
): Promise<ExpenseTab | null> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const tabKey = getTabKey(groupId, tabId);
  const data = await redis.get<ExpenseTab>(tabKey);

  if (!data) {
    return null;
  }

  return data;
}

/**
 * List all tabs for a group.
 */
export async function listTabs(groupId: string): Promise<ExpenseTab[]> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const tabsListKey = getTabsListKey(groupId);
  const tabIds = await redis.smembers(tabsListKey) as string[];

  if (!tabIds || tabIds.length === 0) {
    return [];
  }

  const tabs: ExpenseTab[] = [];
  for (const tabId of tabIds) {
    const tab = await getTab(groupId, tabId);
    if (tab) {
      tabs.push(tab);
    }
  }

  return tabs;
}

/**
 * Add an expense to a tab.
 */
export async function addExpense(
  groupId: string,
  tabId: string,
  expense: Expense
): Promise<ExpenseTab> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const tab = await getTab(groupId, tabId);
  if (!tab) {
    throw new Error(`Tab not found: ${tabId}`);
  }

  tab.expenses.push(expense);

  const tabKey = getTabKey(groupId, tabId);
  await redis.set(tabKey, tab);

  return tab;
}

/**
 * Delete an expense from a tab.
 */
export async function deleteExpense(
  groupId: string,
  tabId: string,
  expenseId: string
): Promise<ExpenseTab> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const tab = await getTab(groupId, tabId);
  if (!tab) {
    throw new Error(`Tab not found: ${tabId}`);
  }

  const initialLength = tab.expenses.length;
  tab.expenses = tab.expenses.filter(e => e.id !== expenseId);

  if (tab.expenses.length === initialLength) {
    throw new Error(`Expense not found: ${expenseId}`);
  }

  const tabKey = getTabKey(groupId, tabId);
  await redis.set(tabKey, tab);

  return tab;
}

/**
 * Update an expense in a tab.
 */
export async function updateExpense(
  groupId: string,
  tabId: string,
  expenseId: string,
  updates: Partial<Expense>
): Promise<ExpenseTab> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const tab = await getTab(groupId, tabId);
  if (!tab) {
    throw new Error(`Tab not found: ${tabId}`);
  }

  const expenseIndex = tab.expenses.findIndex(e => e.id === expenseId);
  if (expenseIndex === -1) {
    throw new Error(`Expense not found: ${expenseId}`);
  }

  tab.expenses[expenseIndex] = {
    ...tab.expenses[expenseIndex],
    ...updates,
  };

  const tabKey = getTabKey(groupId, tabId);
  await redis.set(tabKey, tab);

  return tab;
}

