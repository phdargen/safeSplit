/**
 * Core types for the expense splitter action provider.
 */

/**
 * Represents a single expense in a tab.
 */
export interface Expense {
  /**
   * Unique identifier for the expense.
   */
  id: string;

  /**
   * ID of the tab this expense belongs to.
   */
  tabId: string;

  /**
   * Inbox ID of the person who paid.
   */
  payerInboxId: string;

  /**
   * Ethereum address of the person who paid.
   */
  payerAddress: string;

  /**
   * Amount paid (as string to avoid precision issues).
   */
  amount: string;

  /**
   * Description of the expense.
   */
  description: string;

  /**
   * List of participant inbox IDs who share this expense.
   */
  participantInboxIds: string[];

  /**
   * Optional weights for splitting (defaults to equal split if not provided).
   * Length must match participantInboxIds if provided.
   */
  weights?: number[];

  /**
   * Timestamp when the expense was created.
   */
  timestamp: number;

  /**
   * Currency of the expense (e.g., "USDC").
   */
  currency: string;
}

/**
 * Represents an expense tab for a group.
 */
export interface ExpenseTab {
  /**
   * Unique identifier for the tab.
   */
  id: string;

  /**
   * Human-readable name for the tab.
   */
  name: string;

  /**
   * XMTP group ID this tab belongs to.
   */
  groupId: string;

  /**
   * Participants in this tab (snapshot of group members at creation).
   */
  participants: Array<{
    inboxId: string;
    address: string;
  }>;

  /**
   * Array of expenses in this tab.
   */
  expenses: Expense[];

  /**
   * Timestamp when the tab was created.
   */
  createdAt: number;

  /**
   * Default currency for this tab.
   */
  currency: string;
}

/**
 * Represents a balance for a participant.
 */
export interface Balance {
  /**
   * Inbox ID of the participant.
   */
  inboxId: string;

  /**
   * Ethereum address of the participant.
   */
  address: string;

  /**
   * Net amount owed/owing.
   * Positive = owed to them (they paid more than their share).
   * Negative = they owe (they paid less than their share).
   */
  netAmount: string;
}

/**
 * Represents a settlement transfer between two people.
 */
export interface Settlement {
  /**
   * Inbox ID of the person who owes money.
   */
  fromInboxId: string;

  /**
   * Ethereum address of the person who owes money.
   */
  fromAddress: string;

  /**
   * Ethereum address of the person to receive money.
   */
  toAddress: string;

  /**
   * Amount to transfer.
   */
  amount: string;

  /**
   * Currency for the transfer.
   */
  currency: string;

  /**
   * Human-readable description.
   */
  description: string;
}

/**
 * Response type for multi-transaction preparation.
 * This structured format allows the chatbot to detect and process prepared settlements.
 * Each settlement represents one payer with potentially multiple payment calls batched together.
 */
export interface MultiTransactionPrepared {
  /**
   * Type marker to identify this as a multi-transaction response.
   */
  type: "MULTI_TRANSACTION_PREPARED";

  /**
   * Human-readable description.
   */
  description: string;

  /**
   * Array of settlements grouped by payer.
   * Each settlement contains all transactions for one payer (batched together).
   */
  settlements: Array<{
    /**
     * Inbox ID of the payer.
     */
    fromInboxId: string;

    /**
     * Ethereum address of the payer.
     */
    fromAddress: string;

    /**
     * Currency for the transfers.
     */
    currency: string;

    /**
     * Human-readable description of this settlement.
     */
    description: string;

    /**
     * Array of transaction calls for this payer (batched).
     * Each call represents a payment to a different recipient.
     */
    calls: Array<{
      to: string;
      data: string;
      value: string;
    }>;

    /**
     * Metadata about each transfer (one per call).
     */
    metadata: Array<{
      description?: string;
      tokenAddress: string;
      amount: string;
      destinationAddress: string;
      tokenName?: string;
      tokenDecimals?: number;
    }>;
  }>;
}

