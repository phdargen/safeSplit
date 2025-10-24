/**
 * Settlement transaction tracking and notification handling
 */

import type { MessageContext } from "@xmtp/agent-sdk";
import type { TransactionReference } from "@xmtp/content-type-transaction-reference";
import { ContentTypeMarkdown } from "@xmtp/content-type-markdown";
import { updateSettlementTransaction, findAndRemovePendingTransaction } from "./action-providers/expenseSplitter/storage";
import { resolveAddressToDisplayName } from "./identity-resolver";
import { createPublicClient, http } from "viem";
import { base,baseSepolia } from "viem/chains";

/**
 * Query blockchain to get ERC20 transfer details from a transaction.
 */
async function getERC20TransferDetails(
  txHash: string
): Promise<{ recipient: string; amount: string } | null> {
  try {

    const client = createPublicClient({
      chain: process.env.NETWORK_ID === "base-sepolia" ? baseSepolia : base,
      transport: process.env.RPC_URL ? http(process.env.RPC_URL) : http(),
    });

    // Wait for transaction to be confirmed and indexed
    const receipt = await client.waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
    });

    if (receipt.status !== "success") {
      console.log(`   Transaction failed or reverted`);
      return null;
    }

    // Find ERC20 Transfer event in logs
    // Transfer(address indexed from, address indexed to, uint256 value)
    // Event signature: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
    const transferEventSignature = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    
    const transferLog = receipt.logs.find(
      log => log.topics[0] === transferEventSignature && log.topics.length >= 3
    );

    if (!transferLog) {
      console.log(`   No ERC20 Transfer event found in logs`);
      return null;
    }

    // Extract recipient (to address) from topics[2]
    // Topics are 32 bytes, address is last 20 bytes
    const recipientTopic = transferLog.topics[2];
    const recipient = "0x" + recipientTopic.slice(-40);

    // Extract amount from data field
    const amount = BigInt(transferLog.data).toString();

    return { recipient, amount };
  } catch (error) {
    console.error("Error querying transaction:", error);
    return null;
  }
}

/**
 * Handle a confirmed settlement transaction.
 * This function is called when a user confirms a transaction reference.
 * Returns true if this was a settlement transaction, false otherwise.
 */
export async function handleSettlementTransaction(
  ctx: MessageContext,
  transactionRef: TransactionReference
): Promise<boolean> {
  try {
    const senderInboxId = ctx.message.senderInboxId;
    console.log(`\n✅ Transaction confirmed: ${transactionRef.reference}`);
    console.log(`   Sender: ${senderInboxId.slice(0, 8)}...`);
    console.log(`   Network: ${transactionRef.networkId}`);

    // Query blockchain to get transaction details
    console.log(`🔍 Querying blockchain for transaction details...`);
    const txDetails = await getERC20TransferDetails(
      transactionRef.reference
    );

    if (!txDetails) {
      console.log(`   ⚠️ Could not parse ERC20 transfer details - not a settlement transaction`);
      return false;
    }

    console.log(`   Recipient: ${txDetails.recipient}`);
    console.log(`   Amount: ${txDetails.amount}`);

    // Try to find matching pending transaction in Redis
    const metadata = await findAndRemovePendingTransaction(
      senderInboxId,
      txDetails.recipient,
      txDetails.amount
    );

    if (!metadata) {
      console.log(`   ⚠️ No matching pending settlement found - not a settlement transaction`);
      return false;
    }

    console.log(`   ✅ Matched settlement transaction!`);
    console.log(`   Group: ${metadata.groupId.slice(0, 8)}...`);
    console.log(`   Tab: ${metadata.tabId.slice(0, 8)}...`);
    console.log(`   Settlement: ${metadata.settlementId.slice(0, 8)}...`);
    console.log(`   Transaction: ${metadata.settlementTransactionId.slice(0, 8)}...`);

    // Load tab and update transaction status
    const updatedTab = await updateSettlementTransaction(
      metadata.groupId,
      metadata.tabId,
      metadata.settlementId,
      metadata.settlementTransactionId,
      transactionRef.reference
    );

    // Find the confirmed transaction to get details
    const confirmedTransaction = updatedTab.currentSettlement?.transactions.find(
      t => t.id === metadata.settlementTransactionId
    );

    if (!confirmedTransaction) {
      console.error("Could not find confirmed transaction in updated tab");
      return true;
    }

    // Resolve display names for the transaction
    const fromDisplayName = await resolveAddressToDisplayName(confirmedTransaction.fromAddress);
    const toDisplayName = await resolveAddressToDisplayName(confirmedTransaction.toAddress);

    // Get block explorer URL
    const blockExplorerUrl = process.env.NETWORK_ID === "base-mainnet" ? "https://basescan.org/tx/" : "https://sepolia.basescan.org/tx/";

    // Send confirmation to current conversation (could be DM)
    await ctx.conversation.send(
      `✅ Transaction confirmed!\n\n` +
      `📄 [View Transaction](${blockExplorerUrl}${transactionRef.reference})\n\n` +
      `Thank you for settling up!`,
      ContentTypeMarkdown
    );

    // Get the group conversation to send notification
    try {
      const groupConversation = await ctx.client.conversations.getConversationById(metadata.groupId);
      
      if (!groupConversation) {
        console.error(`Could not find group conversation: ${metadata.groupId}`);
        return true;
      }

      // Calculate progress
      const confirmedCount = updatedTab.currentSettlement?.transactions.filter(t => t.status === "confirmed").length || 0;
      const totalCount = updatedTab.currentSettlement?.transactions.length || 0;

      // Format notification based on tab status
      let notification: string;
      
      if (updatedTab.status === "settled") {
        // All transactions complete
        notification = 
          `🎉 Settlement Complete!\n\n` +
          `Tab "${updatedTab.name}" is now fully settled.\n` +
          `All ${totalCount} transaction(s) have been confirmed.\n\n` +
          `✅ Latest: ${fromDisplayName} → ${toDisplayName} (${confirmedTransaction.amount} ${confirmedTransaction.toAddress.startsWith('0x') ? 'USDC' : updatedTab.currency})\n` +
          `📄 [View Transaction](${blockExplorerUrl}${transactionRef.reference})`;
      } else if (updatedTab.status === "settling") {
        // First or subsequent transaction (but not complete)
        const isFirst = confirmedCount === 1;
        notification = 
          `💸 Settlement Progress: ${confirmedCount}/${totalCount}\n\n` +
          `${isFirst ? '🔒 Tab is now locked for settlement.\n\n' : ''}` +
          `✅ ${fromDisplayName} → ${toDisplayName} (${confirmedTransaction.amount} ${confirmedTransaction.toAddress.startsWith('0x') ? 'USDC' : updatedTab.currency})\n` +
          `📄 [View Transaction](${blockExplorerUrl}${transactionRef.reference})\n\n` +
          `${totalCount - confirmedCount} transaction(s) remaining.`;
      } else {
        // Shouldn't happen, but handle gracefully
        notification = 
          `✅ Settlement transaction confirmed\n\n` +
          `${fromDisplayName} → ${toDisplayName} (${confirmedTransaction.amount} ${updatedTab.currency})\n` +
          `📄 [View Transaction](${blockExplorerUrl}${transactionRef.reference})`;
      }

      // Send notification to the group
      await groupConversation.send(notification, ContentTypeMarkdown);
      console.log(`📨 Sent settlement notification to group ${metadata.groupId.slice(0, 8)}...`);

    } catch (error) {
      console.error("Error sending notification to group:", error);
      // Don't fail the whole operation if notification fails
    }

    return true;

  } catch (error) {
    console.error("Error handling settlement transaction:", error);
    const blockExplorerUrl = process.env.NETWORK_ID === "base-mainnet" ? "https://basescan.org/tx/" : "https://sepolia.basescan.org/tx/";
    await ctx.conversation.send(
      `⚠️ Error processing transaction confirmation: ${error}\n\n` +
      `📄 [View Transaction](${blockExplorerUrl}${transactionRef.reference})`,
      ContentTypeMarkdown
    );
    return false;
  }
}

