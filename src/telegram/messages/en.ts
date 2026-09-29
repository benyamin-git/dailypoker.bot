import {
  ANTE,
  CAP,
  CURRENCY_NAME,
  DAILY_AMOUNT,
  MAX_PLAYERS,
  MIN_JOIN_BALANCE,
  MIN_PLAYERS,
  TURN_SECONDS,
} from "../../config";
import type { Card, MatchState, PlayerState, Street } from "../../engine/types";
import { boardText, cardsText, escapeHtml, formatAmount, formatDurationEn, nameOf } from "./shared";
import type {
  ActivityView,
  BalanceView,
  HistoryView,
  KeyboardLabels,
  Lang,
  LeaderboardRow,
  LobbyView,
  Messages,
  StatsView,
} from "./types";

const STREET_LABEL: Record<Street, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

function headline(view: ActivityView): string {
  const { names, activity } = view;
  let text: string;
  switch (activity.type) {
    case "start": {
      const first = view.match.actorUserId;
      const name = first === null ? "—" : nameOf(names, first);
      text = `🚀 Hand #${view.match.handNo} — ${name} acts first`;
      break;
    }
    case "action": {
      const name = nameOf(names, activity.userId);
      switch (activity.kind) {
        case "fold":
          text = `❌ ${name} folds`;
          break;
        case "check":
          text = `✅ ${name} checks`;
          break;
        case "call":
          text = `📞 ${name} calls ${formatAmount(activity.to ?? 0)}`;
          break;
        case "bet":
          text = `🔥 ${name} bets ${formatAmount(activity.to ?? 0)}`;
          break;
        case "raise":
          text = `🔥 ${name} raises to ${formatAmount(activity.to ?? 0)}`;
          break;
        case "allin":
          text = `🚨 ${name} is all-in — ${formatAmount(activity.to ?? 0)}`;
          break;
      }
      break;
    }
    case "timeout": {
      const name = nameOf(names, activity.userId);
      const verb = activity.kind === "check" ? "checked" : "folded";
      text = `⏰ ${name} timed out — ${verb}`;
      break;
    }
    case "street":
      text = `🎲 ${STREET_LABEL[activity.street]}: ${cardsText(activity.cards)}`;
      break;
  }
  return text;
}

function stateLines(match: MatchState, names: Map<number, string>): string[] {
  const lines = [
    `🃏 Hand #${match.handNo} — ${STREET_LABEL[match.street]} · 💰 Pot ${formatAmount(
      match.pot,
    )} · cap ${CAP}`,
  ];
  const board = boardText(match.board, "Board:");
  if (board) {
    lines.push("", board);
  }
  const seated = match.order
    .map((userId) => match.players.find((player) => player.userId === userId))
    .filter((player): player is PlayerState => player !== undefined);
  lines.push("", "Still in");
  for (const player of seated) {
    if (player.folded) {
      continue;
    }
    const stack = player.allIn
      ? `all-in ${formatAmount(player.contribution)}`
      : `in ${formatAmount(player.contribution)}`;
    const hole = match.revealed && player.hole ? ` — ${cardsText(player.hole)}` : "";
    lines.push(`${player.allIn ? "🚨" : "👤"} ${nameOf(names, player.userId)} — ${stack}${hole}`);
  }
  const out = seated.filter((player) => player.folded);
  if (out.length > 0) {
    lines.push("", "Out");
    for (const player of out) {
      lines.push(`✖ ${nameOf(names, player.userId)} — in ${formatAmount(player.contribution)}`);
    }
  }
  return lines;
}

function nextLine(match: MatchState, names: Map<number, string>): string | null {
  if (match.status === "done") {
    return "⏭ Hand over — result below";
  }
  if (match.runout) {
    return "⏭ Next: running out the board…";
  }
  if (match.actorUserId === null) {
    return null;
  }
  const actor = match.players.find((player) => player.userId === match.actorUserId);
  if (!actor) {
    return null;
  }
  const call = Math.max(0, match.currentBet - actor.streetContribution);
  const action = call > 0 ? `call ${formatAmount(call)}` : "check";
  return `⏭ Next: ${nameOf(names, actor.userId)} — ${action} · ${TURN_SECONDS}s to act`;
}

export const enLabels: KeyboardLabels = {
  join: "Join",
  leave: "Leave",
  takeover: "🙋 Take over",
  deal: "🚀 Deal",
  cancel: "Cancel",
  openBot: "📬 Open bot",
  cards: "🂠 Cards",
  fold: "Fold",
  check: "Check",
  call: (amount) => `Call ${amount}`,
  raise: "Raise ▾",
  bet: (amount) => `Bet ${amount}`,
  raiseMin: (to) => `Min — to ${to}`,
  raiseStep: (step, to) => `+${step} — to ${to}`,
  allIn: (to) => `All-in — ${to}`,
  custom: "✏️ Custom",
  showHand: "Show my hand",
  rematch: "🔁 Rematch",
  resetGroup: "⚠️ Reset this group",
};

export const en: Messages = {
  labels: enLabels,

  pingText() {
    return "🏓 pong (dev)";
  },

  unknownGroupText() {
    return "Sorry, this bot is private and only plays in its owner's group.";
  },

  welcomeText() {
    return [
      "🃏 <b>Welcome to Daily Poker!</b>",
      "",
      "I run poker games in your group chat. Your cards and stats arrive here in DM.",
      "",
      `Get chips with /daily (once per day, +${DAILY_AMOUNT}).`,
      "/rules /help /stats /balance /history",
    ].join("\n");
  },

  helpText(isDm: boolean) {
    const group = [
      "<b>Group commands</b>",
      "/newmatch — open a lobby",
      "/join · /leave — lobby seats",
      "/deal · /cancel — starter actions",
      "/takeover — become the starter",
      "/fold · /check · /call · /raise 40 · /allin — betting",
      "/show — reveal your mucked hand",
      "/cards — re-send your cards by DM",
      "/balance · /top — chips and leaderboard",
      "/rules — full ruleset",
      "/fa · /en — switch the bot language",
    ];
    const dm = [
      "<b>DM commands</b>",
      `/daily — claim +${DAILY_AMOUNT} chips`,
      "/balance · /stats · /history — your numbers",
      "/cards — re-send your hole cards",
      "/rules — full ruleset",
      "/fa · /en — switch the bot language",
    ];
    return [...(isDm ? dm : group), "", "Play chips only — no real money."].join("\n");
  },

  rulesText() {
    return [
      "<b>Daily Poker rules</b>",
      "",
      `• Entry: ${ANTE} each at the deal.`,
      `• Cap: ${CAP} chips per player per hand (entry included) — reaching it is all-in.`,
      "• Bets and raises are multiples of 10; the minimum raise matches the previous raise.",
      `• ${TURN_SECONDS} seconds per action — timeout checks when free, otherwise folds.`,
      "• Showdown: best five of seven. Winner shows; losers may /show.",
      "• Split pots divide evenly; leftover chips go to the earliest hand order.",
      `• Play chips only. Claim +${DAILY_AMOUNT} with /daily when you run low (need ${MIN_JOIN_BALANCE} to play).`,
    ].join("\n");
  },

  lobbyText(view: LobbyView) {
    if (view.expired) {
      return "⌛ <b>Lobby expired.</b>\nStart a new match with /newmatch.";
    }
    const starter =
      view.starterId === null ? "— (tap Take over)" : nameOf(view.names, view.starterId);
    const joined = view.playerIds.map((id) => nameOf(view.names, id)).join(", ") || "—";
    const lines = [
      "🃏 <b>Daily Poker — Lobby</b>",
      `Entry ${ANTE} each · max ${CAP} per hand · ${MIN_PLAYERS}–${MAX_PLAYERS} players`,
      "",
      `Can deal: ${starter}`,
      `Joined (${view.playerIds.length}): ${joined}`,
    ];
    if (view.error) {
      lines.push("", `⚠️ ${escapeHtml(view.error)}`);
    } else if (view.playerIds.length < 2) {
      lines.push("", "Waiting for more players…");
    } else {
      lines.push("", "Ready to deal.");
    }
    return lines.join("\n");
  },

  lobbyStartedText(handNo: number) {
    return `✅ Hand #${handNo} started — updates below.`;
  },

  activityText(view: ActivityView) {
    const lines = [`<b>${headline(view)}</b>`, "", ...stateLines(view.match, view.names)];
    const next = nextLine(view.match, view.names);
    if (next !== null) {
      lines.push("", next);
    }
    return lines.join("\n");
  },

  resultText(match, names, shown) {
    const winnerNames = match.winners.map((id) => nameOf(names, id));
    let line: string;
    if (match.winners.length > 1) {
      line = `🏆 <b>${winnerNames.join(", ")} split ${formatAmount(match.pot)}</b>`;
    } else {
      const delta = match.winners[0] === undefined ? 0 : (match.deltas[match.winners[0]] ?? 0);
      line = `🏆 <b>${winnerNames[0] ?? "—"} wins ${formatAmount(match.pot)} (${
        delta >= 0 ? "+" : ""
      }${formatAmount(delta)})</b>`;
    }
    const winnerCards = match.winners
      .map((id) => {
        const player = match.players.find((candidate) => candidate.userId === id);
        return player?.shown ? player.hole : undefined;
      })
      .filter((hole): hole is [Card, Card] => hole !== undefined);
    if (winnerCards.length > 0) {
      line += ` — ${winnerCards.map((hole) => cardsText(hole)).join(" / ")}`;
    }
    const lines = [line];
    const board = boardText(match.board, "Board:");
    if (board) {
      lines.push(board);
    }
    for (const [userId, hole] of shown) {
      lines.push(`👁 ${nameOf(names, userId)} shows ${cardsText(hole)}`);
    }
    return lines.join("\n");
  },

  dmCardsText(handNo: number, hole: [Card, Card]) {
    return [
      `🂠 <b>Your hand — Hand #${handNo}</b>`,
      cardsText(hole),
      "",
      "Board and betting happen in the group.",
    ].join("\n");
  },

  lobbyExpiredAlert() {
    return "This lobby is no longer open. Start a new match with /newmatch.";
  },

  notInMatchAlert() {
    return "You're not in this match";
  },

  notYourTurnAlert(name: string) {
    return `It's ${name}'s turn`;
  },

  staleMoveAlert() {
    return "That move is no longer available";
  },

  needDmAlert() {
    return "You need to open my DM first so I can send your cards.";
  },

  joinedDmText() {
    return "You're in! I'll DM your cards when the hand starts.";
  },

  noMatchAlert() {
    return "There is no open match.";
  },

  matchOpenAlert() {
    return "A match is already open";
  },

  matchActiveAlert() {
    return "A match is in progress. Finish it first.";
  },

  needBalanceAlert() {
    return `You need at least ${MIN_JOIN_BALANCE} ${CURRENCY_NAME} to play. Claim with /daily.`;
  },

  tableFullAlert() {
    return `Table is full (${MAX_PLAYERS}/${MAX_PLAYERS})`;
  },

  alreadyJoinedAlert() {
    return "You're already in.";
  },

  onlyStarterAlert() {
    return "Only the starter can do that.";
  },

  takeoverAlert() {
    return "You can't take over right now.";
  },

  cardsNoneAlert() {
    return "You're not holding cards right now.";
  },

  showNoneAlert() {
    return "There's nothing to show.";
  },

  glitchAlert() {
    return "Something glitched. Try again.";
  },

  amountMultipleAlert() {
    return "Amounts are multiples of 10";
  },

  raiseCapAlert(maxTo: number) {
    return `You can raise to at most ${maxTo}`;
  },

  noRaiseAlert() {
    return "You can't raise right now.";
  },

  raiseTypeText() {
    return "Type /raise <amount> (multiples of 10).";
  },

  raisePickText() {
    return "Pick an amount or type /raise <amount>.";
  },

  yourHandAlert(cards: string) {
    return `Your hand: ${cards}`;
  },

  inAlert() {
    return "You're in.";
  },

  lobbyClosedText() {
    return "Lobby closed.";
  },

  lobbyCanceledText() {
    return "Lobby canceled.";
  },

  needMorePlayersError() {
    return "Need at least 2 players to deal.";
  },

  playerBrokeError(name: string) {
    return `${name} doesn't have enough chips (needs ${MIN_JOIN_BALANCE}).`;
  },

  nothingPendingText() {
    return "Nothing to confirm. Send /resetgroup first.";
  },

  resetGroupPromptText(groupTitle: string | null, chatId: number) {
    const group = groupTitle === null ? "this group" : `<b>${escapeHtml(groupTitle)}</b>`;
    return [
      `⚠️ Reset ALL data for ${group} (${chatId})?`,
      "",
      "This wipes every player, balance, stat and hand history. It cannot be undone.",
      "",
      "Tap the button, then type RESET.",
    ].join("\n");
  },

  resetGroupArmedText() {
    return "⚠️ Armed. Type RESET (all caps) to wipe the group now.";
  },

  resetGroupMismatchText() {
    return "That is not the confirmation word. Type RESET exactly.";
  },

  dailyClaimedText(balance: number) {
    return `✅ +${DAILY_AMOUNT} chips claimed. Balance: ${formatAmount(
      balance,
    )}. Next claim in 24h.`;
  },

  dailyTooEarlyText(remainingMs: number) {
    return `⏳ Already claimed. Next claim in ${formatDurationEn(remainingMs)}.`;
  },

  dailyTeaserText(name: string) {
    return `🎁 ${escapeHtml(name)} claimed their daily chips.`;
  },

  dailyStatus(lastDailyAt: number | null, now: number, cooldownMs: number) {
    if (lastDailyAt === null || now - lastDailyAt >= cooldownMs) {
      return "ready now";
    }
    return `next in ${formatDurationEn(cooldownMs - (now - lastDailyAt))}`;
  },

  balanceText(view: BalanceView, cooldownMs: number) {
    const net = view.chipsWon - view.chipsLost;
    return [
      `💰 Balance: ${formatAmount(view.balance)} ${CURRENCY_NAME}`,
      `🌅 Daily: ${this.dailyStatus(view.lastDailyAt, view.now, cooldownMs)}`,
      `📈 Record: ${view.handsPlayed} hands · ${view.handsWon} wins · ${
        net >= 0 ? "+" : ""
      }${formatAmount(net)} ${CURRENCY_NAME}`,
    ].join("\n");
  },

  statsText(player: StatsView, groupTitle: string | null) {
    const net = player.chipsWon - player.chipsLost;
    const winRate =
      player.handsPlayed === 0 ? 0 : Math.round((player.handsWon / player.handsPlayed) * 100);
    const lines = [
      `📊 <b>Your stats${groupTitle ? ` — ${escapeHtml(groupTitle)}` : ""}</b>`,
      `Hands: ${player.handsPlayed} · Wins: ${player.handsWon} (${winRate}%)`,
      `Net: ${net >= 0 ? "+" : ""}${formatAmount(net)} · Biggest pot: ${formatAmount(
        player.biggestPot,
      )}`,
    ];
    if (player.bestHand) {
      lines.push(`Best hand: ${escapeHtml(player.bestHand)}`);
    }
    return lines.join("\n");
  },

  historyText(rows: HistoryView[]) {
    if (rows.length === 0) {
      return "📜 No hands played yet.";
    }
    const lines = ["📜 <b>Last hands</b>"];
    for (const row of rows) {
      const marker = row.won ? "🏆" : "💔";
      const sign = row.delta >= 0 ? "+" : "−";
      const parts = [`#${row.handNo}`, marker, `${sign}${formatAmount(Math.abs(row.delta))}`];
      if (row.hole) {
        parts.push(cardsText(row.hole));
      }
      if (row.board.length > 0) {
        parts.push(`board: ${cardsText(row.board)}`);
      }
      lines.push(parts.join("  "));
    }
    return lines.join("\n");
  },

  leaderboardText(rows: LeaderboardRow[], groupTitle: string | null) {
    const lines = [`🏆 <b>Leaderboard${groupTitle ? ` — ${escapeHtml(groupTitle)}` : ""}</b>`];
    if (rows.length === 0) {
      lines.push("No chips claimed yet.");
      return lines.join("\n");
    }
    rows.forEach((row, index) => {
      lines.push(`${index + 1}. ${escapeHtml(row.firstName)}  ${formatAmount(row.balance)}`);
    });
    return lines.join("\n");
  },

  versionText(version: string, webhookUrl: string | null, pending: number) {
    return [
      `🤖 dailypoker.bot v${version}`,
      `Webhook: ${webhookUrl ?? "not set"}`,
      `Pending updates: ${pending}`,
    ].join("\n");
  },

  resetGroupDoneText(chatId: number) {
    return `🧹 Group ${chatId} wiped.`;
  },

  ownerOnlyText() {
    return "Owner only.";
  },

  languageSetText(lang: Lang) {
    return lang === "fa" ? "✅ Language set to Persian / فارسی." : "✅ Language set to English.";
  },
};
