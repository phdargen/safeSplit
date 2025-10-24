![CapyTab](capyTab.jpg)

# CapyTab - AI Group Expense Manager

**CapyTab** is an intelligent XMTP agent that transforms group expense tracking and settlement. Built with CDP AgentKit, Capy lives in your group chats to track expenses, calculate optimal settlements and prepare onchain transactions while keeping users in full control of their funds through external wallet approval.

Think of it as having a smart accountant in your group chat who never forgets who paid for dinner and always knows the fairest way to settle up.

This application demonstrates advanced XMTP integration with AI agents. The app includes:
- **Group expense tracking** - Track shared expenses with automatic participant detection
- **Intelligent settlement** - Minimizes transaction count using debt consolidation algorithms
- **External wallet control** - Prepares transactions for user approval (never holds funds)
- **Real-time settlement tracking** - Monitors blockchain for confirmations and updates group automatically
- **Identity resolution** - ENS and Basename support for human-readable addresses
- **Group polls** - Make collective decisions together
- **Token swaps & transfers** - Full DeFi capabilities via 0x protocol integration

## Why External Wallet Architecture?

CapyTab was built with a unique **non-custodial architecture** where the AI agent never holds or controls user funds:

- **User Sovereignty**: Each user approves transactions with their own wallet, maintaining complete control
- **Trustless Operation**: No need to trust the agent with funds—it only prepares transaction data
- **Production-Ready Security**: Eliminates the primary attack vector of autonomous agent fund theft
- **Compliance-Friendly**: Users remain in control at all times, no intermediary custody

The agent leverages XMTP's WalletSendCalls content type (EIP-5792) to prepare transaction payloads, which are then presented to users for approval in their own wallets.

## Key Innovations

### 🎯 1. Group Expense Settlement with Onchain Verification

The expense splitting system goes beyond simple tracking—it **automatically consolidates debts** and prepares optimal settlement transactions:

```
Alice paid $60 for dinner (split among 3)
Bob paid $30 for drinks (split among 3)
Carol paid $15 for dessert (split among 3)

❌ Naive approach: 9 transactions (everyone pays everyone)
✅ CapyTab's algorithm: 2-3 optimized transactions

Capy calculates net balances:
- Alice is owed $40
- Bob is owed $10  
- Carol owes $50

Settlement: Carol → Alice ($40), Carol → Bob ($10)
```

The agent then:
1. Prepares USDC transfer transactions for each settlement
2. Sends WalletSendCalls to the appropriate payer
3. Monitors blockchain for transaction confirmations
4. Automatically matches confirmed transactions to pending settlements
5. Updates group with real-time progress notifications

### 🔒 2. Real-Time Settlement Tracking

When a user confirms a settlement transaction, CapyTab:
- **Queries the blockchain** to extract ERC20 transfer details (recipient, amount)
- **Matches against pending settlements** stored in Redis with (sender, recipient, amount) tuples
- **Updates tab status** from "settlement_proposed" → "settling" → "settled"
- **Notifies the group** with progress updates and transaction links

This creates a seamless experience where the group is automatically notified as settlements complete, without requiring manual confirmation messages.

### 🆔 3. Human-Friendly Identity Resolution

Every interaction uses **display names instead of addresses**:

**Example:**
- User says: `"Send 10 USDC to alice"`
- Agent resolves: `alice` → `alice.base.eth` → `0x742d35...`
- Output shows: `"✅ alice → bob (10.00 USDC)"` instead of `"✅ 0x742d... → 0x1234... (10.00 USDC)"`

The system:
- Auto-appends `.base.eth` to short names
- Resolves ENS names (vitalik.eth) and Basenames (alice.base.eth)
- Caches resolutions with 12-hour TTL
- Falls back to truncated addresses (0x1234...5678)

### 🤖 4. Dual-Agent System with Context-Aware Behavior

CapyTab uses **separate agent instances** for DMs and groups:

**DM Agent:** Token operations, swaps, market info
- ERC20 token transfers
- Balance checks
- Token swaps (via 0x protocol)
- Group creation

**Group Agent:** Expense tracking, polls, settlement
- Settlement transactions
- Tab management
- Group polls
- Member management

In groups, Capy only responds to messages tagged with `@capy` or `/capy`, preventing spam while remaining accessible.

### 💾 5. Redis-Backed Persistent Storage

All expense data persists in Upstash Redis:

- **Tabs**: Track expense history and participant lists
- **Settlements**: Store pending transaction metadata for matching
- **Session data**: Cache group metadata and member information
- **TTL management**: Pending transactions expire after 24 hours

The storage system enables the settlement tracker to match confirmed blockchain transactions back to their originating expense tabs, creating a complete audit trail from "Alice paid for dinner" to the final onchain settlement.

## Prerequisites

- Node.js v20+ (install via [nvm](https://github.com/nvm-sh/nvm))
- pnpm package manager
- Upstash Redis instance (free tier works great)
- OpenAI API key

## Environment Variables

Create a `.env` file with the following variables:

```bash
# Required - LLM Configuration
OPENAI_API_KEY=sk-...                            # Your OpenAI API key
LLM_MODEL=gpt-4o-mini                           # or "gpt-4", "gpt-4o", etc.

# Required - XMTP Configuration
XMTP_WALLET_KEY=0x...                           # Generate with: pnpm run gen:keys
XMTP_DB_ENCRYPTION_KEY=...                      # Generate with: pnpm run gen:keys
XMTP_ENV=dev                                    # or "production"
AGENT_INBOX_ID=...                              # Optional: from gen:keys output

# Required - Redis Configuration (for expense tracking)
UPSTASH_REDIS_REST_URL=https://...upstash.io   # Your Upstash Redis URL
UPSTASH_REDIS_REST_TOKEN=...                    # Your Upstash Redis token

# Optional - Network Configuration
NETWORK_ID=base-sepolia                         # or "base-mainnet", "ethereum-mainnet"
RPC_URL=https://...                             # Custom RPC endpoint (optional)

# Optional - Railway Deployment
RAILWAY_VOLUME_MOUNT_PATH=/data                 # Volume mount path for persistent DB
```

## Setup

1. **Install dependencies:**
```bash
pnpm install
```

2. **Generate XMTP keys:**
```bash
pnpm run gen:keys
```

This will output:
- `XMTP_WALLET_KEY`: Private key for XMTP agent
- `XMTP_DB_ENCRYPTION_KEY`: Encryption key for local database
- `AGENT_INBOX_ID`: Inbox ID for agent (optional)

3. **Set up Upstash Redis:**

Visit [upstash.com](https://upstash.com/) and create a free Redis database. Copy the REST URL and token to your `.env` file.

4. **Build the application:**
```bash
pnpm build
```

5. **Start the agent:**
```bash
pnpm start
```

## Usage

Once started, you'll see:

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

### Create a Group Chat

**In a DM with Capy:**
```
"Create a group with alice.base.eth, bob.base.eth, and carol.base.eth"
```

Capy creates the group, adds all members, and activates expense tracking features.

### Track Expenses

**In the group chat:**
```
@capy Create a tab called "Weekend Trip"

@capy I paid $60 for dinner

@capy Bob paid $30 for drinks, split between alice and carol

@capy Show tab info
```

### Settle Up

**When ready to settle:**
```
@capy Settle expenses
```

Capy:
1. Calculates net balances for all participants
2. Determines optimal settlement transactions
3. Prepares USDC transfer transactions
4. Sends WalletSendCalls to each payer
5. Tracks confirmations and updates group in real-time

### Create Polls

**Make group decisions:**
```
@capy Create a poll: Where should we eat?
Options: Pizza, Sushi, Tacos
Deadline: tomorrow at 8pm
```

### DM Features

**Token operations (no @capy tag needed in DMs):**
```
"Send 10 USDC to alice.base.eth"

"Check my USDC balance"

"Swap 0.01 ETH for USDC"

"What's the current price of BTC?"
```

## Architecture

### Transaction Flow

```
User: "@capy Settle expenses"
    ↓
Agent: Calculates optimal settlements
    ↓
Agent: Prepares USDC transfer transactions
    ↓
Agent: Stores pending transaction metadata in Redis
    key: pendingSettlementTx:{inboxId}
    value: { groupId, tabId, settlementId, transactionId, toAddress, amount }
    ↓
Agent: Sends WalletSendCalls to user (EIP-5792)
    ↓
User: Approves transaction in wallet
    ↓
User: Sends TransactionReference to Capy (optional, automatic in supported wallets)
    ↓
Agent: Receives TransactionReference
    ↓
Agent: Queries blockchain for transaction details
    - Waits for confirmation
    - Extracts recipient and amount from ERC20 Transfer event
    ↓
Agent: Matches transaction against pending settlements
    - Query Redis: pendingSettlementTx:{inboxId}
    - Match by (toAddress, amount)
    ↓
Agent: Updates tab status in Redis
    - Mark transaction as confirmed
    - Update settlement progress
    - If all confirmed: mark tab as "settled"
    ↓
Agent: Notifies group
    "💸 Settlement Progress: 1/3
     ✅ alice → bob (10.00 USDC)
     📄 View Transaction
     2 transaction(s) remaining."
```

### Key Components

- **`chatbot.ts`** - Main entry point, XMTP message handling
- **`lib/agent-config.ts`** - Dual-agent initialization with separate tools
- **`lib/settlement-tracker.ts`** - Blockchain monitoring and settlement matching
- **`lib/identity-resolver.ts`** - ENS/Basename resolution with caching
- **`lib/action-providers/expenseSplitter/`** - Expense tracking and settlement logic
- **`lib/action-providers/poll/`** - Group polling functionality
- **`lib/session-manager.ts`** - Group metadata and participant caching
- **`lib/transaction-handler.ts`** - WalletSendCalls preparation and sending

## Security Considerations

### What CapyTab Can Do
- ✅ Read blockchain state (balances, token info, transaction receipts)
- ✅ Prepare transaction data (ERC20 transfers, swaps)
- ✅ Send transaction requests to users via WalletSendCalls
- ✅ Track confirmed transactions via TransactionReference

### What CapyTab Cannot Do
- ❌ Execute transactions
- ❌ Access or store user private keys


### Privacy & Data

- **On-chain data**: Settlement transactions are public (blockchain inherent property)
- **Expense data**: Stored in your Upstash Redis instance (you control the data)
- **Identity resolution**: Uses public ENS/Basename registries
- **XMTP messages**: End-to-end encrypted by XMTP protocol

## Deployment

### Railway

1. Create a new Railway project
2. Add a Redis database (or link Upstash externally)
3. Add environment variables from `.env`
4. Set up a persistent volume at `/data`
5. Deploy from GitHub

The agent will automatically create and maintain its XMTP database in the persistent volume.

### Docker

```bash
# Build
docker build -t capytab .

# Run
docker run -d \
  --env-file .env \
  -v $(pwd)/data:/data \
  capytab
```

## Development

```bash
# Auto-reload on changes
pnpm run dev

# Type checking
pnpm run build

# Format code
pnpm run format
```

## Troubleshooting

### "Redis not configured"
- Ensure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set
- Test your Redis connection at [console.upstash.com](https://console.upstash.com/)

### Agent not responding in group
- Make sure to tag the agent with `@capy` in your message
- Check the agent is a member of the group
- Use `/welcome` command to verify agent is active

### Settlement transaction not detected
- Wait 10-30 seconds for blockchain confirmation
- Check transaction succeeded on block explorer
- Verify transaction is USDC transfer (not ETH)
- Ensure TransactionReference was sent (some wallets send automatically)

### Identity resolution failing
- Check network connectivity
- Verify name exists on Base or Ethereum mainnet
- Try with full `.base.eth` or `.eth` suffix explicitly

## Related Documentation

- [XMTP Agent SDK](https://docs.xmtp.org/agents/get-started/build-an-agent)
- [WalletSendCalls (EIP-5792)](https://github.com/xmtp/xmtp-js/tree/main/content-types/content-type-wallet-send-calls)
- [Coinbase AgentKit](https://docs.cdp.coinbase.com/agentkit/docs/welcome)
- [OnchainKit Identity](https://onchainkit.xyz/identity/introduction)


---

**Built with ❤️ using CDP AgentKit, LangChain, and XMTP**

**Never lose track of who paid for what again.** 🦫
