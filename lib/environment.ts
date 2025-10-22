/**
 * Environment validation utilities
 */

export function validateEnvironment(): void {
  const missingVars: string[] = [];

  const requiredVars = [
    "OPENAI_API_KEY",
    "XMTP_WALLET_KEY",
    "XMTP_DB_ENCRYPTION_KEY",
  ];

  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });

  if (missingVars.length > 0) {
    console.error("❌ Error: Required environment variables are not set");
    missingVars.forEach(varName => {
      console.error(`   ${varName}=your_${varName.toLowerCase()}_here`);
    });
    process.exit(1);
  }

  if (!process.env.NETWORK_ID) {
    console.warn("⚠️  Warning: NETWORK_ID not set, defaulting to base-sepolia");
  }

  if (!process.env.XMTP_ENV) {
    console.warn("⚠️  Warning: XMTP_ENV not set, defaulting to dev");
  }
}

