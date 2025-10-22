/**
 * Transaction handling utilities
 */

import { NETWORK_ID_TO_VIEM_CHAIN } from "@coinbase/agentkit";
import type { MessageContext } from "@xmtp/agent-sdk";
import {
  ContentTypeWalletSendCalls,
  type WalletSendCallsParams,
} from "@xmtp/content-type-wallet-send-calls";
import type { TransactionPrepared, MultiTransactionPrepared } from "./action-providers";

/**
 * Send a single transaction request to the user
 */
export async function sendSingleTransaction(
  ctx: MessageContext,
  transactionPrepared: TransactionPrepared,
  senderAddress: string,
  response: string,
): Promise<void> {
  const networkId = process.env.NETWORK_ID || "base-sepolia";
  const chain = NETWORK_ID_TO_VIEM_CHAIN[networkId as keyof typeof NETWORK_ID_TO_VIEM_CHAIN];
  
  if (!chain) {
    await ctx.sendText(`Error: Unsupported network ${networkId}`);
    return;
  }

  const chainId = `0x${chain.id.toString(16)}` as `0x${string}`;

  const walletSendCalls: WalletSendCallsParams = {
    version: "1.0",
    from: senderAddress as `0x${string}`,
    chainId: chainId,
    calls: transactionPrepared.calls.map(call => ({
      to: call.to as `0x${string}`,
      data: call.data as `0x${string}`,
      value: call.value as `0x${string}`,
      metadata: {
        description: transactionPrepared.description,
        transactionType: "erc20_transfer",
        currency: transactionPrepared.metadata.tokenName || "ERC20",
        amount: transactionPrepared.metadata.amount,
        decimals: transactionPrepared.metadata.tokenDecimals?.toString() || "18",
        toAddress: transactionPrepared.metadata.destinationAddress,
        tokenAddress: transactionPrepared.metadata.tokenAddress,
      },
    })),
  };

  console.log(`💳 Sending transaction request to user's wallet...`);
  
  // Send the transaction request to user's wallet
  await ctx.conversation.send(walletSendCalls, ContentTypeWalletSendCalls);
  
  // Send explanatory message
  await ctx.sendText(
    `${response}\n\n💡 Please approve this transaction in your wallet to complete the transfer.`,
  );

  console.log(`✅ Transaction request sent`);
}

/**
 * Send multiple settlement transactions to individual users via DM
 */
export async function sendMultipleTransactions(
  ctx: MessageContext,
  multiTransactionPrepared: MultiTransactionPrepared,
  response: string,
): Promise<void> {
  const networkId = process.env.NETWORK_ID || "base-sepolia";
  const chain = NETWORK_ID_TO_VIEM_CHAIN[networkId as keyof typeof NETWORK_ID_TO_VIEM_CHAIN];
  
  if (!chain) {
    await ctx.sendText(`Error: Unsupported network ${networkId}`);
    return;
  }

  const chainId = `0x${chain.id.toString(16)}` as `0x${string}`;

  console.log(`💳 Preparing to send ${multiTransactionPrepared.settlements.length} settlement transaction(s)...`);

  // Send a summary to the group
  await ctx.sendText(
    `${response}\n\n💡 Settlement prepared! Each person who owes money will receive a DM with their transaction to approve.`
  );

  // Send individual transaction requests to each payer via DM
  for (const settlement of multiTransactionPrepared.settlements) {
    try {
      // Create a DM with the payer
      const dm = await ctx.client.conversations.newDm(settlement.fromInboxId);

      const walletSendCalls: WalletSendCallsParams = {
        version: "1.0",
        from: settlement.fromAddress as `0x${string}`,
        chainId: chainId,
        calls: [{
          to: settlement.call.to as `0x${string}`,
          data: settlement.call.data as `0x${string}`,
          value: settlement.call.value as `0x${string}`,
          metadata: {
            description: settlement.description,
            transactionType: "settlement",
            currency: settlement.currency,
            amount: settlement.amount,
            decimals: settlement.metadata.tokenDecimals?.toString() || "6",
            toAddress: settlement.toAddress,
            tokenAddress: settlement.metadata.tokenAddress,
          },
        }],
      };

      // Send transaction request via DM
      await dm.send(walletSendCalls, ContentTypeWalletSendCalls);
      
      // Send explanatory message
      await dm.send(
        `💸 Settlement Transaction\n\n${settlement.description}\n\n💡 Please approve this transaction in your wallet to complete the settlement.`,
        "text"
      );

      console.log(`✅ Sent settlement transaction to ${settlement.fromInboxId.slice(0, 8)}...`);
    } catch (error) {
      console.error(`Error sending settlement to ${settlement.fromInboxId}:`, error);
      await ctx.sendText(
        `⚠️ Could not send transaction to ${settlement.fromInboxId.slice(0, 8)}... - please try again.`
      );
    }
  }

  console.log(`✅ All settlement transactions sent`);
}

