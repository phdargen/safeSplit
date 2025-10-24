/**
 * Response type for swap transaction preparation.
 * This structured format allows the chatbot to detect and process prepared swap transactions.
 */
export interface SwapTransactionPrepared {
  /**
   * Type marker to identify this as a prepared transaction response.
   */
  type: "SWAP_TRANSACTION_PREPARED";

  /**
   * Human-readable description of the transaction.
   */
  description: string;

  /**
   * Array of transaction calls to be executed.
   * Each call contains the contract address, encoded data, and value.
   * May include approval transaction followed by swap transaction.
   */
  calls: Array<{
    to: string;
    data: string;
    value: string;
    gas?: string;
  }>;

  /**
   * Metadata about each call (one per call).
   * First call may be approval, last call is always the swap.
   */
  metadata: Array<{
    description: string;
    transactionType: string;
    sellToken?: string;
    sellTokenName?: string;
    sellAmount?: string;
    buyToken?: string;
    buyTokenName?: string;
    buyAmount?: string;
    minBuyAmount?: string;
    slippageBps?: string;
  }>;
}

