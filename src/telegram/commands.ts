export interface BotCommand {
  command: string;
  description: string;
}

export const GROUP_COMMANDS: BotCommand[] = [
  { command: "newmatch", description: "Open a poker lobby" },
  { command: "join", description: "Join the open lobby" },
  { command: "leave", description: "Leave the lobby" },
  { command: "deal", description: "Start the hand (starter only)" },
  { command: "cancel", description: "Cancel the lobby (starter only)" },
  { command: "takeover", description: "Take over as starter" },
  { command: "fold", description: "Fold your hand" },
  { command: "check", description: "Check when there is nothing to call" },
  { command: "call", description: "Match the current bet" },
  { command: "raise", description: "Raise to an amount: /raise 40" },
  { command: "allin", description: "Go all-in (up to the 100 cap)" },
  { command: "show", description: "Reveal your mucked hand" },
  { command: "cards", description: "Re-send your hole cards by DM" },
  { command: "balance", description: "Show your chip balance" },
  { command: "top", description: "Show the group leaderboard" },
  { command: "rules", description: "How Daily Poker works" },
  { command: "help", description: "List the commands" },
  { command: "fa", description: "تغییر زبان به فارسی" },
  { command: "en", description: "Switch the language to English" },
  { command: "ping", description: "Check that the bot is alive" },
];

export const PRIVATE_COMMANDS: BotCommand[] = [
  { command: "start", description: "Welcome and join links" },
  { command: "daily", description: "Claim your daily +200 chips" },
  { command: "balance", description: "Show your chip balance" },
  { command: "stats", description: "Show your personal stats" },
  { command: "history", description: "Show your recent hands" },
  { command: "cards", description: "Re-send your hole cards" },
  { command: "rules", description: "How Daily Poker works" },
  { command: "help", description: "List the commands" },
  { command: "fa", description: "تغییر زبان به فارسی" },
  { command: "en", description: "Switch the language to English" },
];
