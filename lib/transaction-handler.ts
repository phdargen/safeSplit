/**
 * Transaction handling utilities
 */

import { NETWORK_ID_TO_VIEM_CHAIN } from "@coinbase/agentkit";
import type { MessageContext } from "@xmtp/agent-sdk";
import { IdentifierKind } from "@xmtp/agent-sdk";
import {
  ContentTypeWalletSendCalls,
  type WalletSendCallsParams,
} from "@xmtp/content-type-wallet-send-calls";
import type { TransactionPrepared, MultiTransactionPrepared } from "./action-providers";
import { addPendingSettlementTransaction } from "./action-providers/expenseSplitter/storage";
import { parseUnits } from "viem";

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

  console.log('sendSingleTransaction called with description:', transactionPrepared.description);

  const chainId = `0x${chain.id.toString(16)}` as `0x${string}`;

  const walletSendCalls: WalletSendCallsParams = {
    version: "2.0",
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
        decimals: transactionPrepared.metadata.tokenDecimals?.toString() || "6",
        toAddress: transactionPrepared.metadata.destinationAddress,
        tokenAddress: transactionPrepared.metadata.tokenAddress,
      },
      capabilities: {
        paymasterService: { url: process.env.NEXT_PUBLIC_PAYMASTER_URL } as unknown as string,
      } as const,
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
 * Falls back to sending in group chat if user cannot receive DMs
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

  console.log(`💳 Preparing to send ${multiTransactionPrepared.settlements.length} settlement transaction(s) on network ${networkId}...`);

  // Check which users can receive DMs
  // Filter out invalid addresses and create identifiers
  const addressesToCheck = multiTransactionPrepared.settlements
    .filter(s => s.fromAddress && s.fromAddress.length > 0)
    .map(s => ({
      identifier: s.fromAddress,
      identifierKind: IdentifierKind.Ethereum,
    }));

  let canMessageMap: Map<string, boolean>;
  try {
    if (addressesToCheck.length > 0) {
      canMessageMap = await ctx.client.canMessage(addressesToCheck);
      console.log(`✅ Checked DM availability for ${addressesToCheck.length} address(es)`);
    } else {
      console.log(`⚠️ No valid addresses to check for DM availability`);
      canMessageMap = new Map();
    }
  } catch (error) {
    console.error("Error checking canMessage, proceeding with DM attempts:", error);
    // If check fails, assume all can receive DMs and try anyway
    canMessageMap = new Map(
      multiTransactionPrepared.settlements
        .filter(s => s.fromAddress && s.fromAddress.length > 0)
        .map(s => [s.fromAddress.toLowerCase(), true])
    );
  }

  // Send a summary to the group
  await ctx.sendText(
    // `${response}\n\n
    `💡 Settlement prepared! Each person who owes money will receive their transaction to approve.`
  );

  // Track DM failures to send in group chat
  const failedDMs: typeof multiTransactionPrepared.settlements = [];

  // Send individual transaction requests to each payer via DM
  for (const settlement of multiTransactionPrepared.settlements) {
    const canDM = canMessageMap.get(settlement.fromAddress.toLowerCase()) ?? false;

    if (!canDM) {
      console.log(`⚠️ User ${settlement.fromAddress.slice(0, 8)}... cannot receive DMs, will send in group`);
      failedDMs.push(settlement);
      continue;
    }

    try {
      // Create a DM with the payer
      const dm = await ctx.client.conversations.newDm(settlement.fromInboxId);

      const walletSendCalls: WalletSendCallsParams = {
        version: "2.0",
        from: settlement.fromAddress as `0x${string}`,
        chainId: chainId,
        calls: settlement.calls.map((call, index) => ({
          to: call.to as `0x${string}`,
          data: call.data as `0x${string}`,
          value: call.value as `0x${string}`,
          metadata: {
            description: settlement.metadata[index].description || settlement.description,
            // Encode custom settlement data in transactionType as JSON
            transactionType: JSON.stringify({
              type: "settlement",
              groupId: settlement.metadata[index].groupId,
              tabId: settlement.metadata[index].tabId,
              settlementId: settlement.metadata[index].settlementId,
              settlementTransactionId: settlement.metadata[index].settlementTransactionId,
            }),
            currency: settlement.currency,
            amount: settlement.metadata[index].amount, 
            decimals: settlement.metadata[index].tokenDecimals?.toString() || "6",
            toAddress: settlement.metadata[index].destinationAddress,
            tokenAddress: settlement.metadata[index].tokenAddress,
          },
        })),
        capabilities: {
          paymasterService: { url: process.env.NEXT_PUBLIC_PAYMASTER_URL } as unknown as string,
        } as const,
      };

      // Build details about payments
      const paymentDetails = settlement.calls.length === 1
        ? `to ${settlement.metadata[0].destinationAddress.slice(0, 6)}...${settlement.metadata[0].destinationAddress.slice(-4)}`
        : `to ${settlement.calls.length} recipients`;

      // Send explanatory message
      await dm.send(
        `💸 Settlement Transaction\n\n${settlement.description}\n\nPayment ${paymentDetails}\n\n💡 Please approve this transaction in your wallet to complete the settlement.`
      );

      // Send transaction request via DM
      await dm.send(walletSendCalls, ContentTypeWalletSendCalls);

      // Store pending transaction metadata for each call
      for (let i = 0; i < settlement.calls.length; i++) {
        // Calculate the EXACT atomic amount that's being sent in the transaction
        // This must match the calculation in prepareSettlementTransactions:
        // parseUnits(settlement.amount, decimals) / BigInt(100)
        const decimals = settlement.metadata[i].tokenDecimals || 6;
        const amountInUnits = parseUnits(settlement.metadata[i].amount, decimals) / BigInt(100); // TO DO: remove this divide by 100, only for testing
        const atomicAmount = amountInUnits.toString();
        
        console.log('settlement.metadata[i].amount', settlement.metadata[i].amount);
        console.log('decimals', decimals);
        console.log('amountInUnits', amountInUnits);
        console.log('atomicAmount', atomicAmount);
        
        await addPendingSettlementTransaction(settlement.fromInboxId, {
          groupId: settlement.metadata[i].groupId,
          tabId: settlement.metadata[i].tabId,
          settlementId: settlement.metadata[i].settlementId,
          settlementTransactionId: settlement.metadata[i].settlementTransactionId,
          toAddress: settlement.metadata[i].destinationAddress, // Recipient address, not token address
          amount: atomicAmount, // EXACT atomic units matching the encoded transaction
          tokenAddress: settlement.metadata[i].tokenAddress,
        });
      }

      console.log(`✅ Sent ${settlement.calls.length} batched settlement call(s) to ${settlement.fromInboxId.slice(0, 8)}... via DM`);
    } catch (error) {
      console.error(`Error sending settlement to ${settlement.fromInboxId}:`, error);
      failedDMs.push(settlement);
    }
  }

  // Send failed DMs in the group chat instead
  for (const settlement of failedDMs) {
    try {
      const walletSendCalls: WalletSendCallsParams = {
        version: "2.0",
        from: settlement.fromAddress as `0x${string}`,
        chainId: chainId,
        calls: settlement.calls.map((call, index) => ({
          to: call.to as `0x${string}`,
          data: call.data as `0x${string}`,
          value: call.value as `0x${string}`,
          metadata: {
            description: settlement.metadata[index].description || settlement.description,
            // Encode custom settlement data in transactionType as JSON
            transactionType: JSON.stringify({
              type: "settlement",
              groupId: settlement.metadata[index].groupId,
              tabId: settlement.metadata[index].tabId,
              settlementId: settlement.metadata[index].settlementId,
              settlementTransactionId: settlement.metadata[index].settlementTransactionId,
            }),
            currency: settlement.currency,
            amount: settlement.metadata[index].amount,
            decimals: settlement.metadata[index].tokenDecimals?.toString() || "6",
            toAddress: settlement.metadata[index].destinationAddress,
            tokenAddress: settlement.metadata[index].tokenAddress,
          },
        })),
        capabilities: {
          paymasterService: { url: process.env.NEXT_PUBLIC_PAYMASTER_URL } as unknown as string,
        } as const,
      };

      // Build details about payments
      const paymentDetails = settlement.calls.length === 1
        ? `to ${settlement.metadata[0].destinationAddress.slice(0, 6)}...${settlement.metadata[0].destinationAddress.slice(-4)}`
        : `to ${settlement.calls.length} recipients`;

      // Send explanatory message
      await ctx.sendText(
        `💸 Settlement for ${settlement.fromAddress.slice(0, 6)}...${settlement.fromAddress.slice(-4)}\n\n${settlement.description}\n\nPayment ${paymentDetails}\n\n💡 Please approve this transaction in your wallet to complete the settlement.`
      );

      // Send transaction request in group chat
      await ctx.conversation.send(walletSendCalls, ContentTypeWalletSendCalls);

      // Store pending transaction metadata for each call
      for (let i = 0; i < settlement.calls.length; i++) {
        // Calculate the EXACT atomic amount that's being sent in the transaction
        // This must match the calculation in prepareSettlementTransactions:
        // parseUnits(settlement.amount, decimals) / BigInt(100)
        const decimals = settlement.metadata[i].tokenDecimals || 6;
        const amountInUnits = parseUnits(settlement.metadata[i].amount, decimals) / BigInt(100);
        const atomicAmount = amountInUnits.toString();
        
        await addPendingSettlementTransaction(settlement.fromInboxId, {
          groupId: settlement.metadata[i].groupId,
          tabId: settlement.metadata[i].tabId,
          settlementId: settlement.metadata[i].settlementId,
          settlementTransactionId: settlement.metadata[i].settlementTransactionId,
          toAddress: settlement.metadata[i].destinationAddress, // Recipient address, not token address
          amount: atomicAmount, // EXACT atomic units matching the encoded transaction
          tokenAddress: settlement.metadata[i].tokenAddress,
        });
      }

      console.log(`✅ Sent ${settlement.calls.length} batched settlement call(s) to ${settlement.fromAddress.slice(0, 8)}... in group chat`);
    } catch (error) {
      console.error(`Error sending settlement in group for ${settlement.fromAddress}:`, error);
      await ctx.sendText(
        `⚠️ Could not send transaction to ${settlement.fromAddress.slice(0, 6)}...${settlement.fromAddress.slice(-4)} - please contact them directly.`
      );
    }
  }

  console.log(`✅ All settlement transactions sent (${multiTransactionPrepared.settlements.length - failedDMs.length} DMs, ${failedDMs.length} in group)`);
}

