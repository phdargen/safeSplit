/**
 * Redis storage operations for expense splitter.
 * Uses Upstash Redis for serverless-friendly persistence.
 */
import { Redis } from "@upstash/redis";
import * as dotenv from "dotenv";
import { ExpenseLedger, Expense } from "./types";

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
 * Generate Redis key for a ledger.
 */
function getLedgerKey(groupId: string, ledgerId: string): string {
  return `expenseSplitter:group:${groupId}:ledger:${ledgerId}`;
}

/**
 * Generate Redis key for the list of ledger IDs in a group.
 */
function getLedgersListKey(groupId: string): string {
  return `expenseSplitter:group:${groupId}:ledgers`;
}

/**
 * Create a new expense ledger.
 */
export async function createLedger(
  groupId: string,
  ledgerId: string,
  ledgerName: string,
  currency: string = "USDC",
  participants: Array<{ inboxId: string; address: string }> = []
): Promise<ExpenseLedger> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const ledger: ExpenseLedger = {
    id: ledgerId,
    name: ledgerName,
    groupId,
    participants,
    expenses: [],
    createdAt: Date.now(),
    currency,
  };

  const ledgerKey = getLedgerKey(groupId, ledgerId);
  const ledgersListKey = getLedgersListKey(groupId);

  // Store the ledger (Upstash Redis handles JSON serialization automatically)
  await redis.set(ledgerKey, ledger);

  // Add ledger ID to the group's ledger list
  await redis.sadd(ledgersListKey, ledgerId);

  return ledger;
}

/**
 * Get a specific ledger by ID.
 */
export async function getLedger(
  groupId: string,
  ledgerId: string
): Promise<ExpenseLedger | null> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const ledgerKey = getLedgerKey(groupId, ledgerId);
  const data = await redis.get<ExpenseLedger>(ledgerKey);

  if (!data) {
    return null;
  }

  return data;
}

/**
 * List all ledgers for a group.
 */
export async function listLedgers(groupId: string): Promise<ExpenseLedger[]> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const ledgersListKey = getLedgersListKey(groupId);
  const ledgerIds = await redis.smembers(ledgersListKey) as string[];

  if (!ledgerIds || ledgerIds.length === 0) {
    return [];
  }

  const ledgers: ExpenseLedger[] = [];
  for (const ledgerId of ledgerIds) {
    const ledger = await getLedger(groupId, ledgerId);
    if (ledger) {
      ledgers.push(ledger);
    }
  }

  return ledgers;
}

/**
 * Add an expense to a ledger.
 */
export async function addExpense(
  groupId: string,
  ledgerId: string,
  expense: Expense
): Promise<ExpenseLedger> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const ledger = await getLedger(groupId, ledgerId);
  if (!ledger) {
    throw new Error(`Ledger not found: ${ledgerId}`);
  }

  ledger.expenses.push(expense);

  const ledgerKey = getLedgerKey(groupId, ledgerId);
  await redis.set(ledgerKey, ledger);

  return ledger;
}

/**
 * Delete an expense from a ledger.
 */
export async function deleteExpense(
  groupId: string,
  ledgerId: string,
  expenseId: string
): Promise<ExpenseLedger> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const ledger = await getLedger(groupId, ledgerId);
  if (!ledger) {
    throw new Error(`Ledger not found: ${ledgerId}`);
  }

  const initialLength = ledger.expenses.length;
  ledger.expenses = ledger.expenses.filter(e => e.id !== expenseId);

  if (ledger.expenses.length === initialLength) {
    throw new Error(`Expense not found: ${expenseId}`);
  }

  const ledgerKey = getLedgerKey(groupId, ledgerId);
  await redis.set(ledgerKey, ledger);

  return ledger;
}

/**
 * Update an expense in a ledger.
 */
export async function updateExpense(
  groupId: string,
  ledgerId: string,
  expenseId: string,
  updates: Partial<Expense>
): Promise<ExpenseLedger> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const ledger = await getLedger(groupId, ledgerId);
  if (!ledger) {
    throw new Error(`Ledger not found: ${ledgerId}`);
  }

  const expenseIndex = ledger.expenses.findIndex(e => e.id === expenseId);
  if (expenseIndex === -1) {
    throw new Error(`Expense not found: ${expenseId}`);
  }

  ledger.expenses[expenseIndex] = {
    ...ledger.expenses[expenseIndex],
    ...updates,
  };

  const ledgerKey = getLedgerKey(groupId, ledgerId);
  await redis.set(ledgerKey, ledger);

  return ledger;
}

