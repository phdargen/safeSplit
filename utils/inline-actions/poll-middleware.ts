/**
 * Poll middleware for handling interactive polls in group chats.
 * Handles vote intents from inline action buttons.
 */
import type { AgentMiddleware } from "@xmtp/agent-sdk";
import {
  ContentTypeIntent,
  type IntentContent,
} from "./types/IntentContent";
import {
  ContentTypeMarkdown,
} from "@xmtp/content-type-markdown";
import {
  getPoll,
  recordVote,
} from "../../lib/action-providers/poll/storage";
import { resolveAddressToDisplayName } from "../../lib/identity-resolver";

/**
 * Format date in a concise way: "Oct 25, 9:38 am"
 */
function formatDeadline(timestamp: number): string {
  const date = new Date(timestamp);
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  const hour12 = hours % 12 || 12;
  
  return `${month} ${day}, ${hour12}:${minutes} ${ampm}`;
}

/**
 * Create a visual progress bar
 */
function createProgressBar(count: number, total: number, barLength: number = 10): string {
  if (total === 0) return '░'.repeat(barLength);
  const filled = Math.round((count / total) * barLength);
  return '█'.repeat(filled) + '░'.repeat(barLength - filled);
}

/**
 * Render poll results with transparent voting (showing who voted for what).
 */
async function renderPollResults(
  poll: {
    id: string;
    question: string;
    createdBy: string;
    options: string[];
    votes: Record<string, { optionIndex: number; voterAddress: string }>;
    deadline: number;
  }
): Promise<string> {
  // Count votes per option
  const voteCounts: number[] = Array(poll.options.length).fill(0);
  const votersByOption: string[][] = Array(poll.options.length)
    .fill(null)
    .map(() => []);

  for (const [inboxId, voteData] of Object.entries(poll.votes)) {
    voteCounts[voteData.optionIndex]++;
    votersByOption[voteData.optionIndex].push(voteData.voterAddress);
  }

  const totalVoters = Object.keys(poll.votes).length;
  const creatorName = await resolveAddressToDisplayName(poll.createdBy);
  const isExpired = Date.now() > poll.deadline;
  const maxCount = Math.max(...voteCounts, 0);
  const winners = maxCount > 0 
    ? poll.options.filter((_, i) => voteCounts[i] === maxCount)
    : [];

  // Build table rows for each option
  const tableRows = poll.options.map((option, i) => {
    const count = voteCounts[i];
    const percentage = totalVoters > 0 ? Math.round((count / totalVoters) * 100) : 0;
    const bar = createProgressBar(count, totalVoters, 10);
    
    return `| **${option}** | \`${bar}\` ${percentage}% (${count}) |`;
  });

  // Build complete markdown message with table
  const content = `### 📊 ${poll.question}

👤 ${creatorName}

⏰ ${formatDeadline(poll.deadline)} ${isExpired ? "🔒" : "✅"}

---

${winners.length > 0 ? `🏆 **${winners.join(" & ")}**\n\n---\n\n` : ""}| Option | Votes |
|--------|-------|
${tableRows.join("\n")}`;

  return content;
}

/**
 * Poll middleware - handles vote intents from inline action buttons.
 */
export const pollMiddleware: AgentMiddleware = async (ctx, next) => {
  try {
    const contentType = ctx.message.contentType;

    // Handle votes from inline actions (Intent messages)
    if (contentType?.sameAs?.(ContentTypeIntent)) {
      const sender = ctx.message.senderInboxId;
      const intent = ctx.message.content as IntentContent;
      
      // Check if this is a poll vote (poll IDs start with "poll-")
      if (!intent.id.startsWith("poll-")) {
        return next();
      }

      const pollId = intent.id;
      const groupId = ctx.conversation.id;
      const poll = await getPoll(groupId, pollId);
      
      if (!poll) {
        return next();
      }

      // Check if this is a "Show Results" action
      if (intent.actionId === "show-results") {
        const results = await renderPollResults(poll);
        await ctx.conversation.send(results, ContentTypeMarkdown);
        return;
      }

      // Handle vote action
      // Check if poll has expired
      if (Date.now() > poll.deadline) {
        await ctx.sendText("⏳ This poll has expired. Voting is closed.");
        return;
      }

      const optionIndex = parseInt(intent.actionId, 10);
      if (isNaN(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
        return;
      }

      // Get voter's address
      const voterAddress = await ctx.getSenderAddress();
      if (!voterAddress) {
        await ctx.sendText("❌ Could not determine your address. Please try again.");
        return;
      }

      // Record the vote
      await recordVote(groupId, pollId, sender, voterAddress, optionIndex);
      
      // Confirm vote with display name
      const senderName = await resolveAddressToDisplayName(voterAddress);
      await ctx.sendText(`✅ Vote recorded from ${senderName} for "${poll.options[optionIndex]}"`);
      return;
    }

    // Default → continue pipeline
    await next();
  } catch (err) {
    console.error("[pollMiddleware] error:", err);
    await next();
  }
};

