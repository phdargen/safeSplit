import { MemorySaver } from "@langchain/langgraph";
import { randomBytes } from "crypto";

/**
 * Generate a unique ID for expenses and tabs.
 */
export function generateId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Format currency amount for display.
 */
export function formatCurrency(amount: string, currency: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) {
    return `${amount} ${currency}`;
  }
  return `${num.toFixed(2)} ${currency}`;
}

/**
 * Parse amount string to ensure it's a valid number.
 * Returns the amount as a string for precision.
 */
export function parseAmount(amountStr: string): string {
  const cleaned = amountStr.trim().replace(/,/g, "");
  const num = parseFloat(cleaned);
  
  if (isNaN(num) || num <= 0) {
    throw new Error(`Invalid amount: ${amountStr}`);
  }
  
  return num.toString();
}

/**
 * USDC contract addresses by network.
 */
const USDC_ADDRESSES: Record<string, `0x${string}`> = {
  "base-mainnet": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "ethereum-mainnet": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "ethereum-sepolia": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
};

/**
 * Get USDC token address and decimals for the given network.
 */
export function getUSDCDetails(networkId: string): {
  address: `0x${string}`;
  decimals: number;
} {
  const address = USDC_ADDRESSES[networkId];
  if (!address) {
    throw new Error(`USDC not available on network: ${networkId}`);
  }
  return {
    address,
    decimals: 6, // USDC always has 6 decimals
  };
}

/**
 * Add two numeric strings with precision.
 */
export function addAmounts(a: string, b: string): string {
  const numA = parseFloat(a);
  const numB = parseFloat(b);
  return (numA + numB).toString();
}

/**
 * Subtract two numeric strings with precision.
 */
export function subtractAmounts(a: string, b: string): string {
  const numA = parseFloat(a);
  const numB = parseFloat(b);
  return (numA - numB).toString();
}

/**
 * Multiply a numeric string by a number.
 */
export function multiplyAmount(amount: string, multiplier: number): string {
  const num = parseFloat(amount);
  return (num * multiplier).toString();
}

/**
 * Divide a numeric string by a number.
 */
export function divideAmount(amount: string, divisor: number): string {
  const num = parseFloat(amount);
  return (num / divisor).toString();
}

/**
 * Compare two amounts.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function compareAmounts(a: string, b: string): number {
  const numA = parseFloat(a);
  const numB = parseFloat(b);
  if (numA < numB) return -1;
  if (numA > numB) return 1;
  return 0;
}

/**
 * Prepare settlement for a tab by computing optimal transfers.
 * This is a shared utility used by both the action provider and inline actions.
 * 
 * @returns MultiTransactionPrepared object ready to be sent, or error message string
 */
export async function prepareTabSettlement(
  groupId: string,
  tabId: string,
  tokenAddress?: string
): Promise<string> {
  const { getTab, updateTab } = await import("./storage");
  const { computeNetBalances, optimizeSettlements, prepareSettlementTransactions } = await import("./settlement");
  const { resolveAddressToDisplayName } = await import("../../identity-resolver");

  const tab = await getTab(groupId, tabId);
  if (!tab) {
    return `Error: Tab ${tabId} not found in group ${groupId}`;
  }

  // Check tab status
  if (tab.status === "settling") {
    return JSON.stringify({
      success: false,
      message: `Tab "${tab.name}" is already settling. Cannot propose a new settlement.`,
    });
  }

  if (tab.status === "settled") {
    return JSON.stringify({
      success: false,
      message: `Tab "${tab.name}" is already settled. Please create a new tab for new expenses.`,
    });
  }

  if (tab.expenses.length === 0) {
    return `No expenses in tab "${tab.name}". Nothing to settle!`;
  }

  // Get token address (default to USDC for the network)
  const networkId = process.env.NETWORK_ID || "base-sepolia";
  const tokenDetails = tokenAddress
    ? { address: tokenAddress as `0x${string}`, decimals: 6 }
    : getUSDCDetails(networkId);

  // Compute balances (pass participants to ensure all addresses are resolved)
  const balances = computeNetBalances(tab.expenses, tab.participants);

  // Check if everyone is settled
  const hasImbalance = balances.some(b => Math.abs(parseFloat(b.netAmount)) > 0.01);
  if (!hasImbalance) {
    return `✅ All settled! Everyone has paid their fair share.`;
  }

  // Optimize settlements
  const settlements = optimizeSettlements(balances, tab.currency);

  if (settlements.length === 0) {
    return `✅ All settled! Everyone has paid their fair share.`;
  }

  // Generate settlement ID and transaction IDs
  const settlementId = generateId();
  const settlementTransactionIds = settlements.map(() => generateId());

  // Create settlement transactions for tracking
  const settlementTransactions: any[] = settlements.map((settlement, index) => ({
    id: settlementTransactionIds[index],
    fromInboxId: settlement.fromInboxId,
    fromAddress: settlement.fromAddress,
    toAddress: settlement.toAddress,
    amount: settlement.amount,
    status: "pending" as const,
  }));

  // Create settlement record
  const settlementRecord: any = {
    id: settlementId,
    createdAt: Date.now(),
    status: "proposed",
    transactions: settlementTransactions,
  };

  // Update tab with settlement record and status
  tab.currentSettlement = settlementRecord;
  tab.status = "settlement_proposed";
  await updateTab(groupId, tabId, tab);

  // Prepare transactions with metadata
  const transactions = prepareSettlementTransactions(
    settlements,
    tokenDetails.address,
    tokenDetails.decimals,
    groupId,
    tabId,
    settlementId,
    settlementTransactionIds
  );

  // Group transactions by sender (fromInboxId) to batch calls
  const settlementsByPayer = new Map<string, typeof transactions>();
  for (const tx of transactions) {
    const existing = settlementsByPayer.get(tx.settlement.fromInboxId);
    if (existing) {
      existing.push(tx);
    } else {
      settlementsByPayer.set(tx.settlement.fromInboxId, [tx]);
    }
  }

  // Build the multi-transaction response with batched calls per payer (with display names)
  const batchedSettlements = await Promise.all(
    Array.from(settlementsByPayer.values()).map(async txs => {
      const firstTx = txs[0];
      const totalAmount = txs.reduce((sum, tx) => sum + parseFloat(tx.settlement.amount), 0);
      
      // Resolve display names for payer
      const payerDisplayName = await resolveAddressToDisplayName(firstTx.settlement.fromAddress);
      
      // Build descriptions with display names
      const descriptionsWithNames = await Promise.all(txs.map(async tx => {
        const toDisplayName = await resolveAddressToDisplayName(tx.settlement.toAddress);
        return `${payerDisplayName} → ${toDisplayName} (${formatCurrency(tx.settlement.amount, tx.settlement.currency)})`;
      }));
      
      return {
        fromInboxId: firstTx.settlement.fromInboxId,
        fromAddress: firstTx.settlement.fromAddress,
        currency: firstTx.settlement.currency,
        description: txs.length === 1
          ? descriptionsWithNames[0]
          : `${payerDisplayName}: ${txs.length} payments totaling ${formatCurrency(totalAmount.toString(), firstTx.settlement.currency)}`,
        calls: txs.map(tx => tx.call),
        metadata: await Promise.all(txs.map(async (tx, idx) => ({
          ...tx.metadata,
          description: descriptionsWithNames[idx], // Use display name description
        }))),
      };
    })
  );

  const response: any = {
    type: "MULTI_TRANSACTION_PREPARED",
    description: `Settlement for tab "${tab.name}" - ${batchedSettlements.length} payer(s), ${settlements.length} transfer(s)`,
    settlements: batchedSettlements,
  };

  // Return JSON that will be detected by the chatbot
  return JSON.stringify(response);
}
