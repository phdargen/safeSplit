/**
 * Application constants
 */

// USDC contract addresses by network
export const USDC_ADDRESSES: Record<string, `0x${string}`> = {
  "base-mainnet": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "ethereum-mainnet": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "ethereum-sepolia": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
};

// Storage directory for user sessions
export const STORAGE_DIR = ".data/user-sessions";

