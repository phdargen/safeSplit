import { z } from "zod";
import { customActionProvider, EvmWalletProvider } from "@coinbase/agentkit";
import {
  CreatePollSchema,
  VoteOnPollSchema,
  GetPollResultsSchema,
} from "./schemas";
import { PollPrepared } from "./types";
import {
  createPoll,
  getPoll,
  recordVote,
} from "./storage";
import { resolveAddressToDisplayName } from "../../identity-resolver";

/**
 * Generate a unique poll ID.
 */
function generatePollId(): string {
  return `poll-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse deadline string (e.g., "2 hours", "3 days") to timestamp.
 */
function parseDeadline(deadlineStr: string): number {
  const match = deadlineStr.trim().match(/^(\d+)\s*(hour|hours|day|days|h|d)$/i);
  
  if (!match) {
    throw new Error(
      'Invalid deadline format. Use formats like "2 hours", "3 days", "1 hour", "5 days"'
    );
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  let milliseconds: number;
  if (unit.startsWith('h')) {
    milliseconds = amount * 60 * 60 * 1000; // hours to ms
  } else if (unit.startsWith('d')) {
    milliseconds = amount * 24 * 60 * 60 * 1000; // days to ms
  } else {
    throw new Error('Invalid time unit. Use "hours" or "days"');
  }

  return Date.now() + milliseconds;
}

/**
 * Create a new poll.
 */
async function createPollAction(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof CreatePollSchema>
): Promise<string> {
  try {
    // Validate options count
    if (args.options.length < 2) {
      return JSON.stringify({
        success: false,
        message: "A poll needs at least 2 options.",
      });
    }

    if (args.options.length > 10) {
      return JSON.stringify({
        success: false,
        message: "A poll can have at most 10 options.",
      });
    }

    // Parse deadline (defaults to 24 hours)
    let deadline: number;
    try {
      deadline = parseDeadline(args.deadline || "24 hours");
    } catch (error) {
      return JSON.stringify({
        success: false,
        message: `${error}`,
      });
    }

    const pollId = generatePollId();

    // Create poll in storage
    const poll = await createPoll(
      args.groupId,
      pollId,
      args.question,
      args.options,
      args.creatorAddress,
      deadline
    );

    // Return POLL_PREPARED response for interception
    const response: PollPrepared = {
      type: "POLL_PREPARED",
      poll: {
        id: poll.id,
        groupId: poll.groupId,
        question: poll.question,
        options: poll.options,
        deadline: poll.deadline,
      },
    };

    return JSON.stringify(response);
  } catch (error) {
    return JSON.stringify({
      success: false,
      message: `Error creating poll: ${error}`,
    });
  }
}

/**
 * Vote on a poll.
 */
async function voteOnPollAction(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof VoteOnPollSchema>
): Promise<string> {
  try {
    const poll = await getPoll(args.groupId, args.pollId);
    
    if (!poll) {
      return JSON.stringify({
        success: false,
        message: `Poll not found: ${args.pollId}`,
      });
    }

    // Check if poll has expired
    if (Date.now() > poll.deadline) {
      return JSON.stringify({
        success: false,
        message: "This poll has expired. Voting is closed.",
      });
    }

    // Validate option index
    if (args.optionIndex < 0 || args.optionIndex >= poll.options.length) {
      return JSON.stringify({
        success: false,
        message: `Invalid option index. Must be between 0 and ${poll.options.length - 1}.`,
      });
    }

    // Record the vote
    const updatedPoll = await recordVote(
      args.groupId,
      args.pollId,
      args.voterInboxId,
      args.voterAddress,
      args.optionIndex
    );

    return JSON.stringify({
      success: true,
      data: {
        pollId: args.pollId,
        optionIndex: args.optionIndex,
        option: poll.options[args.optionIndex],
      },
      message: `Vote recorded for "${poll.options[args.optionIndex]}"`,
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      message: `Error voting on poll: ${error}`,
    });
  }
}

/**
 * Get poll results.
 */
async function getPollResultsAction(
  walletProvider: EvmWalletProvider,
  args: z.infer<typeof GetPollResultsSchema>
): Promise<string> {
  try {
    const poll = await getPoll(args.groupId, args.pollId);
    
    if (!poll) {
      return JSON.stringify({
        success: false,
        message: `Poll not found: ${args.pollId}`,
      });
    }

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

    // Resolve creator display name
    const creatorName = await resolveAddressToDisplayName(poll.createdBy);

    // Build results message
    const deadlineDate = new Date(poll.deadline);
    const isExpired = Date.now() > poll.deadline;
    
    let message = `🗳️ Poll: ${poll.question}\n`;
    message += `Started by: ${creatorName}\n`;
    message += `Deadline: ${deadlineDate.toLocaleString()} ${isExpired ? "(expired)" : ""}\n\n`;

    // Show each option with votes and voter names
    for (let i = 0; i < poll.options.length; i++) {
      const count = voteCounts[i];
      message += `${poll.options[i]}: ${count} vote${count === 1 ? "" : "s"}\n`;

      if (votersByOption[i].length > 0) {
        // Resolve all voter names (votersByOption now contains addresses)
        const voterNames = await Promise.all(
          votersByOption[i].map((address) => resolveAddressToDisplayName(address))
        );
        message += `  - ${voterNames.join(", ")}\n`;
      }
      message += "\n";
    }

    message += `Total voters: ${totalVoters}\n`;

    // Find winner(s)
    const maxCount = Math.max(...voteCounts, 0);
    if (maxCount > 0) {
      const winners = poll.options.filter((_, i) => voteCounts[i] === maxCount);
      if (winners.length > 1) {
        message += `Tie between: ${winners.join(", ")}`;
      } else {
        message += `Winner: ${winners[0]}`;
      }
    } else {
      message += "No votes yet";
    }

    // Resolve voter display names for data structure
    const resultsWithNames = await Promise.all(
      poll.options.map(async (option, i) => {
        const voterNames = votersByOption[i].length > 0
          ? await Promise.all(votersByOption[i].map((address) => resolveAddressToDisplayName(address)))
          : [];
        return {
          option,
          votes: voteCounts[i],
          voters: voterNames,
        };
      })
    );

    return JSON.stringify({
      success: true,
      data: {
        poll: {
          id: poll.id,
          question: poll.question,
          options: poll.options,
          deadline: poll.deadline,
          isExpired,
        },
        results: resultsWithNames,
        totalVoters,
      },
      message,
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      message: `Error getting poll results: ${error}`,
    });
  }
}

/**
 * Factory function to create poll action provider.
 * Returns a single action provider with all poll actions.
 */
export const pollActionProvider = () => {
  const provider = customActionProvider<EvmWalletProvider>([
    {
      name: "create_poll",
      description: `
      This tool creates a new poll in an XMTP group.      
      Use this when users want to create a poll to gather opinions or make decisions.
      `,
      schema: CreatePollSchema,
      invoke: createPollAction,
    },
    {
      name: "vote_on_poll",
      description: `
      This tool records a vote for a poll option.
      Use this when users want to vote on an existing poll using natural language.
      `,
      schema: VoteOnPollSchema,
      invoke: voteOnPollAction,
    },
    {
      name: "get_poll_results",
      description: `
      This tool gets the current results of a poll.
      Use this when users want to see poll results or check voting status.
      `,
      schema: GetPollResultsSchema,
      invoke: getPollResultsAction,
    },
  ]);

  return [provider];
};

