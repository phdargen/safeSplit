/**
 * Tab operations for expense tracking and balance calculations.
 */
import { Expense } from "./types";
import { formatCurrency, addAmounts, subtractAmounts, multiplyAmount, divideAmount } from "./utils";

/**
 * Format a list of expenses for display.
 */
export function formatExpensesList(expenses: Expense[], currency: string): string {
  if (expenses.length === 0) {
    return "No expenses recorded yet.";
  }

  let output = `📋 Expenses (${expenses.length} total):\n\n`;

  let totalAmount = "0";
  for (const expense of expenses) {
    const date = new Date(expense.timestamp).toLocaleDateString();
    const participantCount = expense.participantInboxIds.length;
    
    output += `• ${formatCurrency(expense.amount, expense.currency)} - ${expense.description}\n`;
    output += `  Paid by: ${expense.payerAddress.slice(0, 8)}...\n`;
    output += `  Split among: ${participantCount} people\n`;
    output += `  Date: ${date}\n`;
    output += `  ID: ${expense.id.slice(0, 8)}\n\n`;

    totalAmount = addAmounts(totalAmount, expense.amount);
  }

  output += `💰 Total expenses: ${formatCurrency(totalAmount, currency)}`;

  return output;
}

/**
 * Distribute an expense among participants according to weights.
 * Returns a map of inboxId -> amount owed.
 */
export function distributeExpense(expense: Expense): Map<string, string> {
  const distribution = new Map<string, string>();
  const { participantInboxIds, weights, amount } = expense;

  if (weights && weights.length !== participantInboxIds.length) {
    throw new Error("Weights array must match participants array length");
  }

  if (weights) {
    // Weighted split
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    
    for (let i = 0; i < participantInboxIds.length; i++) {
      const inboxId = participantInboxIds[i];
      const weight = weights[i];
      const share = multiplyAmount(divideAmount(amount, totalWeight), weight);
      distribution.set(inboxId, share);
    }
  } else {
    // Equal split
    const sharePerPerson = divideAmount(amount, participantInboxIds.length);
    
    for (const inboxId of participantInboxIds) {
      distribution.set(inboxId, sharePerPerson);
    }
  }

  return distribution;
}

/**
 * Calculate net balances for all participants in a list of expenses.
 * Positive balance = they paid more than their share (others owe them).
 * Negative balance = they paid less than their share (they owe others).
 */
export function calculateBalances(expenses: Expense[]): Map<string, string> {
  const balances = new Map<string, string>();

  // Process each expense
  for (const expense of expenses) {
    // Credit the payer with the full amount
    const currentPayerBalance = balances.get(expense.payerInboxId) || "0";
    balances.set(
      expense.payerInboxId,
      addAmounts(currentPayerBalance, expense.amount)
    );

    // Distribute the expense among participants
    const distribution = distributeExpense(expense);
    
    for (const [inboxId, owedAmount] of distribution.entries()) {
      const currentBalance = balances.get(inboxId) || "0";
      balances.set(inboxId, subtractAmounts(currentBalance, owedAmount));
    }
  }

  return balances;
}

/**
 * Format balances for display.
 */
export function formatBalances(
  balances: Map<string, string>,
  currency: string,
  inboxIdToAddress?: Map<string, string>
): string {
  if (balances.size === 0) {
    return "No balances to show.";
  }

  let output = "💳 Current Balances:\n\n";

  const entries = Array.from(balances.entries());
  
  // Separate creditors and debtors
  const creditors = entries.filter(([_, amount]) => parseFloat(amount) > 0.01);
  const debtors = entries.filter(([_, amount]) => parseFloat(amount) < -0.01);
  const settled = entries.filter(([_, amount]) => Math.abs(parseFloat(amount)) <= 0.01);

  if (creditors.length > 0) {
    output += "✅ Owed to:\n";
    for (const [inboxId, amount] of creditors) {
      const displayId = inboxIdToAddress?.get(inboxId) || inboxId.slice(0, 8) + "...";
      output += `  • ${displayId}: +${formatCurrency(amount, currency)}\n`;
    }
    output += "\n";
  }

  if (debtors.length > 0) {
    output += "💸 Owes:\n";
    for (const [inboxId, amount] of debtors) {
      const displayId = inboxIdToAddress?.get(inboxId) || inboxId.slice(0, 8) + "...";
      const absAmount = multiplyAmount(amount, -1);
      output += `  • ${displayId}: -${formatCurrency(absAmount, currency)}\n`;
    }
    output += "\n";
  }

  if (settled.length > 0) {
    output += "⚖️  Settled:\n";
    for (const [inboxId] of settled) {
      const displayId = inboxIdToAddress?.get(inboxId) || inboxId.slice(0, 8) + "...";
      output += `  • ${displayId}: ${formatCurrency("0", currency)}\n`;
    }
  }

  return output.trim();
}

/**
 * Validate that all participant inbox IDs are in the group.
 */
export function validateExpenseParticipants(
  participantInboxIds: string[],
  validInboxIds: string[]
): void {
  const validSet = new Set(validInboxIds);
  
  for (const inboxId of participantInboxIds) {
    if (!validSet.has(inboxId)) {
      throw new Error(`Participant ${inboxId} is not in the group`);
    }
  }
}

/**
 * Calculate total expenses amount.
 */
export function calculateTotalExpenses(expenses: Expense[]): string {
  let total = "0";
  for (const expense of expenses) {
    total = addAmounts(total, expense.amount);
  }
  return total;
}

/**
 * Calculate detailed balances including total paid and net settlement.
 */
export function calculateDetailedBalances(
  expenses: Expense[],
  participants: Array<{ inboxId: string; address: string }>
): Array<{
  inboxId: string;
  address: string;
  totalPaid: string;
  netSettlement: string;
  status: "owes" | "owed" | "settled";
}> {
  // Calculate net balances
  const netBalances = calculateBalances(expenses);
  
  // Calculate total paid by each participant
  const totalPaidMap = new Map<string, string>();
  for (const expense of expenses) {
    const current = totalPaidMap.get(expense.payerInboxId) || "0";
    totalPaidMap.set(expense.payerInboxId, addAmounts(current, expense.amount));
  }
  
  // Build detailed balance array
  const detailedBalances = [];
  
  // Include all participants, even those with no activity
  for (const participant of participants) {
    const netAmount = netBalances.get(participant.inboxId) || "0";
    const totalPaid = totalPaidMap.get(participant.inboxId) || "0";
    const netValue = parseFloat(netAmount);
    
    let status: "owes" | "owed" | "settled";
    if (netValue > 0.01) {
      status = "owed";
    } else if (netValue < -0.01) {
      status = "owes";
    } else {
      status = "settled";
    }
    
    detailedBalances.push({
      inboxId: participant.inboxId,
      address: participant.address,
      totalPaid,
      netSettlement: netAmount,
      status,
    });
  }
  
  return detailedBalances;
}

