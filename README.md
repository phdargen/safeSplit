# CDP AgentKit LangChain XMTP External Wallet Example

This example demonstrates an XMTP agent that **prepares transactions for user approval** instead of executing them directly. Users maintain full control of their funds by signing transactions with their own wallets.

## 🎯 Key Features

- **User-Controlled Funds**: Agent never holds or executes transactions
- **Transaction Preparation**: Agent prepares ERC20 transfers for user approval
- **Balance Checking**: Check user's token balances on-chain
- **XMTP Integration**: Seamless messaging with transaction requests
- **WalletSendCalls**: Uses XMTP's transaction request content type

## 🔄 How It Works

```
1. User: "Send 10 USDC to 0xabc..."
2. Agent: Validates balance, prepares transaction
3. Agent → User: Sends WalletSendCalls via XMTP
4. User: Approves transaction in their wallet
5. User → Agent: Sends TransactionReference (optional)
6. Agent: Confirms transaction completion
```

## 🆚 Comparison with Standard Agent

| Feature | Standard XMTP Agent | External Wallet Agent |
|---------|-------------------|---------------------|
| **Fund Control** | Agent's wallet | User's wallet |
| **Transaction Execution** | Agent signs & executes | User signs & executes |
| **Setup Complexity** | Requires CDP wallet | No wallet needed |
| **Use Case** | Autonomous agent | User-approved actions |
| **Security Model** | Trust agent | Trust yourself |

## 🚀 Try These Commands

Once your agent is running, send these messages via XMTP:

- `"Check my USDC balance"`
- `"What's my wallet balance?"`
- `"Send 1 USDC to 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"`
- `"Transfer 5 USDC to vitalik.eth"` (if ENS is supported)

## 📋 Prerequisites

### Node Version

This example requires **Node.js 20 or higher**:

```bash
node --version
```

If needed, install using [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 20
nvm use 20
```

### API Keys

You'll need:

- [OpenAI API Key](https://platform.openai.com/docs/quickstart#create-and-export-an-api-key)
- Optional: Custom RPC URL for better performance

**Note:** Unlike the standard agent, this does **NOT** require CDP API keys because it doesn't create or manage wallets.

### Environment Setup

1. Copy the environment template:
```bash
cp .env-local .env
```

2. Generate XMTP keys:
```bash
pnpm run gen:keys
```

3. Fill in your `.env` file:

```env
# Required
OPENAI_API_KEY=your_openai_api_key_here
XMTP_WALLET_KEY=0x...  # From gen:keys
XMTP_DB_ENCRYPTION_KEY=...  # From gen:keys

# Optional
XMTP_ENV=dev  # or "production"
NETWORK_ID=base-sepolia  # or "base-mainnet", "ethereum-mainnet", etc.
RPC_URL=  # Custom RPC URL (optional)
```

## 🛠️ Installation & Running

### From Root Directory

```bash
# Install dependencies and build
pnpm install
pnpm build

# Navigate to example
cd typescript/examples/langchain-xmtp-externalWallet

# Start the agent
pnpm start
```

### Development Mode

For auto-reload during development:

```bash
pnpm run dev
```

## 📡 Interacting with Your Agent

Once started, you'll see output like:

```
═══════════════════════════════════════════════════════════════════════
🎉 EXTERNAL WALLET AGENT STARTED
═══════════════════════════════════════════════════════════════════════
📡 XMTP Environment:    dev
⛓️  Blockchain Network:   base-sepolia
💵 USDC Token Address:  0x036CbD53842c5426634e7929541eC2318f3dCF7e
📬 Agent Address:        0x1234...5678
🔗 Chat with agent:      http://xmtp.chat/dm/0x1234...5678?env=dev
═══════════════════════════════════════════════════════════════════════
```

### Ways to Chat:

1. **Web Interface**: Click the provided URL
2. **XMTP Client**: Use any XMTP client (Converse, etc.)
3. **Custom Integration**: Build your own UI

## 🏗️ Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                        XMTP Network                          │
│  (User ↔ Agent messaging with WalletSendCalls)             │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                     XMTP Agent SDK                           │
│  (Message handling, content type codecs)                     │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                   LangChain ReAct Agent                      │
│  (GPT-4o-mini for intent understanding)                      │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                      AgentKit                                │
│  (Tool orchestration & action providers)                     │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│            ExternalWalletERC20ActionProvider                 │
│  - get_erc20_balance: Check user's token balance            │
│  - prepare_erc20_transfer: Prepare transaction data         │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│              ReadOnlyEvmWalletProvider                       │
│  (RPC access for reading blockchain state)                   │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                    Blockchain RPC                            │
│  (Base Sepolia / Base Mainnet / etc.)                        │
└─────────────────────────────────────────────────────────────┘
```

### Transaction Flow

```typescript
// 1. User sends message
"Send 10 USDC to 0xabc..."

// 2. Agent extracts user address from XMTP
const userAddress = await ctx.getSenderAddress();

// 3. Agent calls prepare_erc20_transfer tool
{
  amount: "10",
  tokenAddress: "0x036Cb...", // USDC
  destinationAddress: "0xabc...",
  userAddress: "0xuser..."
}

// 4. Tool validates & returns JSON
{
  type: "TRANSACTION_PREPARED",
  calls: [{
    to: "0x036Cb...",
    data: "0xa9059cbb...", // encoded transfer()
    value: "0"
  }]
}

// 5. Agent converts to WalletSendCalls
{
  version: "1.0",
  from: "0xuser...",
  chainId: "0x14a34",
  calls: [...]
}

// 6. Agent sends via XMTP
await ctx.conversation.send(walletSendCalls, ContentTypeWalletSendCalls);

// 7. User approves in wallet
// (External to agent)

// 8. User optionally sends TransactionReference
{
  networkId: "base-sepolia",
  reference: "0xtxhash..."
}

// 9. Agent confirms
"✅ Transaction confirmed! Hash: 0xtxhash..."
```

## 🔧 Customization

### Add More Tokens

Edit `USDC_ADDRESSES` in `chatbot.ts`:

```typescript
const TOKEN_ADDRESSES: Record<string, Record<string, `0x${string}`>> = {
  "base-sepolia": {
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    WETH: "0x4200000000000000000000000000000000000006",
    // Add more...
  }
};
```

### Change Network

Set in `.env`:

```env
NETWORK_ID=base-mainnet  # or ethereum-mainnet, arbitrum-mainnet, etc.
```

### Modify Agent Personality

Edit `messageModifier` in `initializeAgent()`:

```typescript
messageModifier: `
  You are a friendly DeFi assistant specializing in USDC transfers.
  Always explain transactions clearly before preparing them.
  // ... your custom instructions
`
```

### Add More Action Providers

```typescript
const agentkit = await AgentKit.from({
  walletProvider,
  actionProviders: [
    externalWalletERC20ActionProvider(),
    // Add more providers here
    // externalWalletNFTActionProvider(), // Future
  ],
});
```

## 🧪 Testing

### Manual Testing

1. Start the agent: `pnpm start`
2. Open the chat URL in your browser
3. Try commands like:
   - "What's my USDC balance?"
   - "Send 0.1 USDC to 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"

### With Test Tokens

On Base Sepolia, get test USDC:
1. Get test ETH from [Base Sepolia faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet)
2. Use a DEX or faucet to get test USDC

## 🛡️ Security Considerations

### What This Agent Can Do
- ✅ Read blockchain state (balances, token info)
- ✅ Prepare transaction data
- ✅ Send transaction requests to users

### What This Agent Cannot Do
- ❌ Execute transactions
- ❌ Access user's private keys
- ❌ Sign messages on user's behalf
- ❌ Transfer user's funds without approval

### Best Practices

1. **Always Validate**: Agent validates balances and addresses before preparing txs
2. **User Control**: Users must explicitly approve all transactions
3. **Clear Communication**: Agent explains what transactions will do
4. **Error Handling**: Proper error messages for invalid requests
5. **Session Management**: User addresses tracked per session

## 🐛 Troubleshooting

### "Could not determine your wallet address"
- Ensure you're using an XMTP client that provides Ethereum address
- Check XMTP environment matches (dev/production)

### "Insufficient balance" errors
- Verify user has tokens in their wallet
- Check you're on the correct network
- Ensure token address is correct

### Agent not responding
- Check XMTP environment variables are set
- Verify OPENAI_API_KEY is valid
- Check network connectivity and RPC URL

### Transaction not appearing in wallet
- Ensure wallet supports WalletSendCalls (EIP-5792)
- Check network ID matches wallet network
- Try a compatible wallet (Coinbase Wallet, etc.)

## 📚 Related Documentation

- [XMTP Agent SDK](https://docs.xmtp.org/agents/get-started/build-an-agent)
- [WalletSendCalls Content Type](https://github.com/xmtp/xmtp-js/tree/main/content-types/content-type-wallet-send-calls)
- [CDP AgentKit](https://docs.cdp.coinbase.com/agentkit/docs/welcome)
- [EIP-5792: Wallet Call API](https://eips.ethereum.org/EIPS/eip-5792)

## 🤝 Contributing

Found a bug or want to add a feature? Contributions are welcome!

1. Fork the repository
2. Create your feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

Apache-2.0

---

**Built with ❤️ using CDP AgentKit and XMTP**

