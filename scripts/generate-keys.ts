import * as crypto from "node:crypto";

/**
 * Generate random keys for the XMTP agent.
 *
 * @returns Object containing random wallet and encryption keys
 */
function generateRandomKeys() {
  // Generate random wallet key (32 bytes)
  const randomBytes = crypto.randomBytes(32);
  const walletKey = `0x${randomBytes.toString("hex")}`;

  // Generate random encryption key (32 bytes)
  const randomBytesForEncryption = crypto.randomBytes(32);
  const encryptionKey = `0x${randomBytesForEncryption.toString("hex")}`;

  return { walletKey, encryptionKey };
}

/**
 * Main function to generate and display XMTP keys.
 */
async function main() {
  try {
    console.log("🔑 Generating random XMTP keys...\n");

    // Generate random keys
    const { walletKey, encryptionKey } = generateRandomKeys();

    console.log("📋 Your XMTP keys:");
    console.log(`XMTP_WALLET_KEY=${walletKey}`);
    console.log(`XMTP_DB_ENCRYPTION_KEY=${encryptionKey.slice(2)}`);
    console.log("\n✨ Copy these keys and add them to your .env file");
    console.log("\n⚠️  IMPORTANT: Keep these keys secure and never share them!");
  } catch (error) {
    console.error("❌ Error generating keys:", error);
    process.exit(1);
  }
}

// Call main directly since this is the entry point
main();

