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
