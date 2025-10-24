/**
 * Redis storage operations for polls.
 * Uses Upstash Redis for serverless-friendly persistence.
 */
import { Redis } from "@upstash/redis";
import * as dotenv from "dotenv";
import { Poll } from "./types";

dotenv.config();

// Validate environment variables
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.warn(
    "⚠️  Warning: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN not set. " +
    "Polls will not persist data."
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
 * Generate Redis key for a poll.
 */
function getPollKey(groupId: string, pollId: string): string {
  return `poll:group:${groupId}:poll:${pollId}`;
}

/**
 * Generate Redis key for the list of poll IDs in a group.
 */
function getPollsListKey(groupId: string): string {
  return `poll:group:${groupId}:polls`;
}

/**
 * Create a new poll.
 */
export async function createPoll(
  groupId: string,
  pollId: string,
  question: string,
  options: string[],
  createdBy: string,
  deadline: number
): Promise<Poll> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const poll: Poll = {
    id: pollId,
    groupId,
    question,
    options,
    createdBy,
    deadline,
    votes: {},
    createdAt: Date.now(),
  };

  const pollKey = getPollKey(groupId, pollId);
  const pollsListKey = getPollsListKey(groupId);

  // Store the poll
  await redis.set(pollKey, poll);

  // Add poll ID to the group's poll list
  await redis.sadd(pollsListKey, pollId);

  // Set TTL to deadline * 2 (in seconds)
  const now = Date.now();
  const ttlSeconds = Math.max(60, Math.floor(((deadline - now) * 2) / 1000));
  await redis.expire(pollKey, ttlSeconds);

  return poll;
}

/**
 * Get a specific poll by ID.
 */
export async function getPoll(
  groupId: string,
  pollId: string
): Promise<Poll | null> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const pollKey = getPollKey(groupId, pollId);
  const data = await redis.get<Poll>(pollKey);

  if (!data) {
    return null;
  }

  return data;
}

/**
 * Record a vote for a poll.
 */
export async function recordVote(
  groupId: string,
  pollId: string,
  inboxId: string,
  voterAddress: string,
  optionIndex: number
): Promise<Poll> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const poll = await getPoll(groupId, pollId);
  if (!poll) {
    throw new Error(`Poll not found: ${pollId}`);
  }

  // Check if poll has expired
  if (Date.now() > poll.deadline) {
    throw new Error("Poll has expired");
  }

  // Validate option index
  if (optionIndex < 0 || optionIndex >= poll.options.length) {
    throw new Error("Invalid option index");
  }

  // Record the vote with address
  poll.votes[inboxId] = { optionIndex, voterAddress };

  // Save updated poll
  const pollKey = getPollKey(groupId, pollId);
  await redis.set(pollKey, poll);

  return poll;
}

/**
 * List all active (non-expired) polls for a group.
 */
export async function listActivePolls(groupId: string): Promise<Poll[]> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const pollsListKey = getPollsListKey(groupId);
  const pollIds = await redis.smembers(pollsListKey) as string[];

  if (!pollIds || pollIds.length === 0) {
    return [];
  }

  const now = Date.now();
  const activePolls: Poll[] = [];

  for (const pollId of pollIds) {
    const poll = await getPoll(groupId, pollId);
    if (poll && poll.deadline > now) {
      activePolls.push(poll);
    }
  }

  return activePolls;
}

/**
 * Delete a poll.
 */
export async function deletePoll(groupId: string, pollId: string): Promise<void> {
  if (!redis) {
    throw new Error("Redis not configured. Please set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const pollKey = getPollKey(groupId, pollId);
  const pollsListKey = getPollsListKey(groupId);

  // Delete the poll
  await redis.del(pollKey);

  // Remove from the group's poll list
  await redis.srem(pollsListKey, pollId);
}
