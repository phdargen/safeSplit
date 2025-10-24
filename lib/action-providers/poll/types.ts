/**
 * Core types for the poll action provider.
 */

/**
 * Represents a poll in a group.
 */
export interface Poll {
  /**
   * Unique identifier for the poll.
   */
  id: string;

  /**
   * XMTP group ID this poll belongs to.
   */
  groupId: string;

  /**
   * The poll question.
   */
  question: string;

  /**
   * Array of poll options.
   */
  options: string[];

  /**
   * Ethereum address of the person who created the poll.
   */
  createdBy: string;

  /**
   * Deadline timestamp (in milliseconds).
   */
  deadline: number;

  /**
   * Votes recorded: inboxId -> { optionIndex, voterAddress }
   */
  votes: Record<string, { optionIndex: number; voterAddress: string }>;

  /**
   * Timestamp when the poll was created.
   */
  createdAt: number;
}

/**
 * Response type for poll preparation.
 * This structured format allows the chatbot to detect and display inline actions.
 */
export interface PollPrepared {
  /**
   * Type marker to identify this as a poll preparation response.
   */
  type: "POLL_PREPARED";

  /**
   * Poll data for rendering inline actions.
   */
  poll: {
    id: string;
    groupId: string;
    question: string;
    options: string[];
    deadline: number;
  };
}

