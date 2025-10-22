/**
 * Response type for transaction preparation.
 * This structured format allows the chatbot to detect and process prepared transactions.
 */
export interface TransactionPrepared {
  /**
   * Type marker to identify this as a prepared transaction response.
   */
  type: "TRANSACTION_PREPARED";

  /**
   * Human-readable description of the transaction.
   */
  description: string;

  /**
   * Array of transaction calls to be executed.
   * Each call contains the contract address, encoded data, and value.
   */
  calls: Array<{
    to: string;
    data: string;
    value: string;
  }>;

  /**
   * Metadata about the transfer.
   */
  metadata: {
    tokenAddress: string;
    amount: string;
    destinationAddress: string;
    tokenName?: string;
    tokenDecimals?: number;
  };
}

