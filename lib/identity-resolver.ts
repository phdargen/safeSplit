/**
 * Identity resolution service for ENS and Basename lookups.
 * Provides bidirectional resolution: identifier → address and address → display name.
 */

import { getName, getAvatar, getAddress as getAddressFromName } from '@coinbase/onchainkit/identity';
import { base } from 'viem/chains';
import { getAddress, isAddress } from 'viem';

export interface UserIdentity {
  address: string;
  displayName: string;
  username?: string;
  pfpUrl?: string | null;
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

// In-memory cache with 12 hour TTL
const CACHE_TTL_MS = 12 *60 * 60 * 1000;
const identifierToAddressCache = new Map<string, CacheEntry<string>>();
const addressToDisplayNameCache = new Map<string, CacheEntry<UserIdentity>>();

/**
 * Check if input string is a valid Ethereum address format.
 */
export function isEthereumAddress(input: string): boolean {
  return isAddress(input);
}

/**
 * Truncate an Ethereum address for display.
 */
function truncateAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Check if cache entry is still valid.
 */
function isCacheValid<T>(entry: CacheEntry<T> | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

/**
 * Clear all identity caches (useful for testing/debugging).
 */
export function clearIdentityCache(): void {
  identifierToAddressCache.clear();
  addressToDisplayNameCache.clear();
}

/**
 * Try to fetch ENS/Basename and avatar using OnchainKit.
 */
async function getOnchainKitUserInfo(address: string): Promise<UserIdentity | null> {
  try {
    // Try with base chain first
    let ensName: string | null = null;
    try {
      ensName = await getName({ address: address as `0x${string}`, chain: base });
    } catch (error) {
      // If base chain fails, try mainnet
      try {
        ensName = await getName({ address: address as `0x${string}` });
      } catch (innerError) {
        return null;
      }
    }

    if (!ensName) {
      return null;
    }

    // Try to get avatar using the ENS name
    let pfpUrl: string | null = null;
    try {
      pfpUrl = await getAvatar({ ensName, chain: base });
    } catch (error) {
      // If base chain fails, try mainnet
      try {
        pfpUrl = await getAvatar({ ensName });
      } catch (innerError) {
        // Continue without avatar - we still have the ENS name
      }
    }

    return {
      address,
      username: ensName,
      displayName: ensName,
      pfpUrl,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Try to resolve ENS/Basename to address using OnchainKit.
 * If the name doesn't end with .eth, automatically appends .base.eth
 */
async function resolveOnchainKitName(name: string): Promise<string | null> {
  try {
    let nameToResolve = name;
    
    // If it doesn't end with .eth, append .base.eth
    if (!name.endsWith('.eth')) {
      nameToResolve = `${name}.base.eth`;
    }
    
    // Try base chain first
    try {
      const result = await getAddressFromName({ name: nameToResolve, chain: base });
      if (result) return result;
    } catch (error) {
      // Try mainnet
      try {
        const result = await getAddressFromName({ name: nameToResolve });
        if (result) return result;
      } catch (innerError) {
        return null;
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Resolve any identifier (ENS name, Basename, or address) to an Ethereum address.
 * If the name doesn't end with .eth, automatically appends .base.eth
 * Throws error if identifier cannot be resolved.
 */
export async function resolveIdentifierToAddress(identifier: string): Promise<string> {
  if (!identifier) {
    throw new Error("Identifier is required");
  }

  const normalizedInput = identifier.trim();

  // Check cache first
  const cached = identifierToAddressCache.get(normalizedInput.toLowerCase());
  if (isCacheValid(cached)) {
    return cached!.value;
  }

  // If it's already an Ethereum address, validate and return
  if (isEthereumAddress(normalizedInput)) {
    try {
      const checksummed = getAddress(normalizedInput);
      // Cache the result
      identifierToAddressCache.set(normalizedInput.toLowerCase(), {
        value: checksummed,
        timestamp: Date.now(),
      });
      return checksummed;
    } catch (error) {
      throw new Error(`Invalid Ethereum address format: ${normalizedInput}`);
    }
  }

  // Try ENS/Basename resolution (auto-appends .base.eth if needed)
  const onchainKitAddress = await resolveOnchainKitName(normalizedInput);
  if (onchainKitAddress) {
    const checksummed = getAddress(onchainKitAddress);
    identifierToAddressCache.set(normalizedInput.toLowerCase(), {
      value: checksummed,
      timestamp: Date.now(),
    });
    return checksummed;
  }

  // Provide helpful error message
  const attemptedName = normalizedInput.endsWith('.eth') ? normalizedInput : `${normalizedInput}.base.eth`;
  throw new Error(
    `Could not resolve "${attemptedName}" to an Ethereum address. ` +
    `Please provide a valid Ethereum address, ENS name, or Basename.`
  );
}

/**
 * Resolve an Ethereum address to a display name (ENS/Basename → truncated address).
 */
export async function resolveAddressToDisplayName(address: string): Promise<string> {
  if (!address) {
    return "";
  }

  // Normalize address
  let normalizedAddress: string;
  try {
    normalizedAddress = getAddress(address);
  } catch (error) {
    return truncateAddress(address);
  }

  // Check cache first
  const cached = addressToDisplayNameCache.get(normalizedAddress.toLowerCase());
  if (isCacheValid(cached)) {
    return cached!.value.displayName;
  }

  // Try OnchainKit (ENS/Basename)
  const onchainKitInfo = await getOnchainKitUserInfo(normalizedAddress);
  if (onchainKitInfo) {
    addressToDisplayNameCache.set(normalizedAddress.toLowerCase(), {
      value: onchainKitInfo,
      timestamp: Date.now(),
    });
    return onchainKitInfo.displayName;
  }

  // Fallback to truncated address
  const fallbackInfo: UserIdentity = {
    address: normalizedAddress,
    displayName: truncateAddress(normalizedAddress),
  };
  
  addressToDisplayNameCache.set(normalizedAddress.toLowerCase(), {
    value: fallbackInfo,
    timestamp: Date.now(),
  });
  
  return fallbackInfo.displayName;
}

/**
 * Resolve multiple addresses to display names efficiently.
 * Uses bulk API calls where possible.
 */
export async function resolveBulkAddressesToDisplayNames(
  addresses: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  
  if (addresses.length === 0) {
    return result;
  }

  // Process addresses in parallel
  await Promise.all(
    addresses.map(async (address) => {
      try {
        const displayName = await resolveAddressToDisplayName(address);
        result.set(address, displayName);
      } catch (error) {
        console.error(`Error resolving address ${address}:`, error);
        result.set(address, truncateAddress(address));
      }
    })
  );

  return result;
}

/**
 * Get full user identity info for an address.
 */
export async function getUserIdentity(address: string): Promise<UserIdentity> {
  if (!address) {
    return {
      address: "",
      displayName: "",
    };
  }

  // Normalize address
  let normalizedAddress: string;
  try {
    normalizedAddress = getAddress(address);
  } catch (error) {
    return {
      address,
      displayName: truncateAddress(address),
    };
  }

  // Check cache first
  const cached = addressToDisplayNameCache.get(normalizedAddress.toLowerCase());
  if (isCacheValid(cached)) {
    return cached!.value;
  }

  // Try OnchainKit (ENS/Basename)
  const onchainKitInfo = await getOnchainKitUserInfo(normalizedAddress);
  if (onchainKitInfo) {
    addressToDisplayNameCache.set(normalizedAddress.toLowerCase(), {
      value: onchainKitInfo,
      timestamp: Date.now(),
    });
    return onchainKitInfo;
  }

  // Fallback to truncated address
  const fallbackInfo: UserIdentity = {
    address: normalizedAddress,
    displayName: truncateAddress(normalizedAddress),
  };
  
  addressToDisplayNameCache.set(normalizedAddress.toLowerCase(), {
    value: fallbackInfo,
    timestamp: Date.now(),
  });
  
  return fallbackInfo;
}

