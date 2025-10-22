/**
 * Settlement algorithm for computing optimal transfers to settle expenses.
 */
import { encodeFunctionData, erc20Abi, parseUnits, Hex } from "viem";
import { Settlement, Balance, Expense } from "./types";
import { calculateBalances } from "./ledger";
import { compareAmounts, subtractAmounts, formatCurrency } from "./utils";

/**
 * Compute net balances from expenses.
 */
export function computeNetBalances(expenses: Expense[]): Balance[] {
  const balancesMap = calculateBalances(expenses);
  
  const balances: Balance[] = [];
  for (const [inboxId, netAmount] of balancesMap.entries()) {
    // Find the address for this inboxId from expenses
    let address = "";
    for (const expense of expenses) {
      if (expense.payerInboxId === inboxId) {
        address = expense.payerAddress;
        break;
      }
      const participantIndex = expense.participantInboxIds.indexOf(inboxId);
      if (participantIndex !== -1) {
        // For participants, we'll need to look up their address separately
        // For now, we'll leave it empty and let the caller fill it in
        break;
      }
    }

    balances.push({
      inboxId,
      address,
      netAmount,
    });
  }

  return balances;
}

/**
 * Optimize settlements to minimize the number of transfers.
 * Uses a greedy algorithm to match largest debtors with largest creditors.
 */
export function optimizeSettlements(balances: Balance[], currency: string): Settlement[] {
  const settlements: Settlement[] = [];

  // Separate debtors (negative balance) and creditors (positive balance)
  const debtors = balances
    .filter(b => parseFloat(b.netAmount) < -0.01)
    .map(b => ({
      ...b,
      remaining: multiplyByNegativeOne(b.netAmount), // Convert to positive for easier math
    }))
    .sort((a, b) => compareAmounts(b.remaining, a.remaining)); // Sort descending

  const creditors = balances
    .filter(b => parseFloat(b.netAmount) > 0.01)
    .map(b => ({
      ...b,
      remaining: b.netAmount,
    }))
    .sort((a, b) => compareAmounts(b.remaining, a.remaining)); // Sort descending

  let debtorIndex = 0;
  let creditorIndex = 0;

  // Match debtors with creditors
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];

    // Determine the transfer amount (minimum of what debtor owes and what creditor is owed)
    const comparison = compareAmounts(debtor.remaining, creditor.remaining);
    let transferAmount: string;

    if (comparison <= 0) {
      // Debtor owes less than or equal to what creditor is owed
      transferAmount = debtor.remaining;
      creditor.remaining = subtractAmounts(creditor.remaining, transferAmount);
      debtor.remaining = "0";
      debtorIndex++;
    } else {
      // Debtor owes more than what creditor is owed
      transferAmount = creditor.remaining;
      debtor.remaining = subtractAmounts(debtor.remaining, transferAmount);
      creditor.remaining = "0";
      creditorIndex++;
    }

    // Only add settlement if amount is meaningful
    if (parseFloat(transferAmount) > 0.01) {
      settlements.push({
        fromInboxId: debtor.inboxId,
        fromAddress: debtor.address,
        toAddress: creditor.address,
        amount: transferAmount,
        currency,
        description: `Settlement: ${debtor.inboxId.slice(0, 8)}... → ${creditor.inboxId.slice(0, 8)}... (${formatCurrency(transferAmount, currency)})`,
      });
    }
  }

  return settlements;
}

/**
 * Helper to multiply by -1.
 */
function multiplyByNegativeOne(amount: string): string {
  const num = parseFloat(amount);
  return (num * -1).toString();
}

/**
 * Prepare settlement transactions for multiple payers.
 * Returns transaction data for each settlement.
 */
export function prepareSettlementTransactions(
  settlements: Settlement[],
  tokenAddress: `0x${string}`,
  decimals: number
): Array<{
  settlement: Settlement;
  call: {
    to: string;
    data: string;
    value: string;
  };
  metadata: {
    tokenAddress: string;
    amount: string;
    destinationAddress: string;
    tokenName: string;
    tokenDecimals: number;
  };
}> {
  const transactions = [];

  for (const settlement of settlements) {
    // Convert amount to token units using correct decimals
    const amountInUnits = parseUnits(settlement.amount, decimals);

    // Encode the transfer function call
    const transferData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [settlement.toAddress as Hex, amountInUnits],
    });

    transactions.push({
      settlement,
      call: {
        to: tokenAddress,
        data: transferData,
        value: "0",
      },
      metadata: {
        tokenAddress,
        amount: settlement.amount,
        destinationAddress: settlement.toAddress,
        tokenName: settlement.currency,
        tokenDecimals: decimals,
      },
    });
  }

  return transactions;
}

