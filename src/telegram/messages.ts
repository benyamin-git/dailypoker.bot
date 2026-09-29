import {
  ANTE,
  CAP,
  CURRENCY_NAME,
  DAILY_AMOUNT,
  MAX_PLAYERS,
  MIN_JOIN_BALANCE,
  MIN_PLAYERS,
  TURN_SECONDS,
} from "../config";
import type { ActionKind, Card, MatchState, PlayerState, Street } from "../engine/types";
import { formatDuration } from "../util/time";

const SUIT_SYMBOL: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function formatAmount(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const digits = Math.abs(Math.trunc(amount)).toString();
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function cardText(card: Card): string {
  const rank = card[0] === "T" ? "10" : (card[0] as string);
  return `${rank}${SUIT_SYMBOL[card[1] as string]}`;
}

export function cardsText(cards: readonly Card[]): string {
  return cards.map(cardText).join(" ");
}

function nameOf(names: Map<number, string>, userId: number): string {
  return escapeHtml(names.get(userId) ?? `user ${userId}`);
}

export function pingText(): string {
  return "🏓 pong (dev)";
}

export function unknownGroupText(): string {
  return "Sorry, this bot is private and only plays in its owner's group.";
}

export function welcomeText(): string {
  return [
    "🃏 <b>Welcome to Daily Poker!</b>",
    "",
    "I run poker games in your group chat. Your cards and stats arrive here in DM.",
    "",
    `Get chips with /daily (once per day, +200).`,
    "/rules /help /stats /balance /history",
  ].join("\n");
}

export function helpText(isDm: boolean): string {
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
  ];
  const dm = [
    "<b>DM commands</b>",
    "/daily — claim +200 chips",
    "/balance · /stats · /history — your numbers",
    "/cards — re-send your hole cards",
    "/rules — full ruleset",
  ];
  return [...(isDm ? dm : group), "", "Play chips only — no real money."].join("\n");
}

export function rulesText(): string {
  return [
    "<b>Daily Poker rules</b>",
    "",
    `• Everyone antes ${ANTE} at the deal.`,
    `• Cap: ${CAP} chips per player per hand (ante included) — reaching it is all-in.`,
    "• Bets and raises are multiples of 10; the minimum raise matches the previous raise.",
    "• 60 seconds per action — timeout checks when free, otherwise folds.",
    "• Showdown: best five of seven. Winner shows; losers may /show.",
    "• Split pots divide evenly; leftover chips go to the earliest hand order.",
    `• Play chips only. Claim +200 with /daily when you run low (need ${MIN_JOIN_BALANCE} to play).`,
  ].join("\n");
}

export interface LobbyView {
  names: Map<number, string>;
  starterId: number | null;
  playerIds: number[];
  error?: string | null;
  expired?: boolean;
}

export function lobbyText(view: LobbyView): string {
  if (view.expired) {
    return "⌛ <b>Lobby expired.</b>\nStart a new match with /newmatch.";
  }
  const starter =
    view.starterId === null ? "— (tap Take over)" : nameOf(view.names, view.starterId);
  const joined = view.playerIds.map((id) => nameOf(view.names, id)).join(", ") || "—";
  const lines = [
    "🃏 <b>Daily Poker — Lobby</b>",
    `Ante ${ANTE} each · max ${CAP} per hand · ${MIN_PLAYERS}–${MAX_PLAYERS} players`,
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
}

export function lobbyStartedText(handNo: number): string {
  return `✅ Hand #${handNo} started — updates below.`;
}

export type TableActivity =
  | { type: "start" }
  | { type: "action"; userId: number; kind: ActionKind; to: number | null }
  | { type: "timeout"; userId: number; kind: "check" | "fold" }
  | { type: "street"; street: Street; cards: Card[] };

export interface ActivityView {
  match: MatchState;
  names: Map<number, string>;
  activity: TableActivity;
}

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

function boardText(board: readonly Card[]): string | null {
  if (board.length === 0) {
    return null;
  }
  const slots: string[] = [];
  for (let i = 0; i < 5; i++) {
    slots.push(board[i] ? cardText(board[i] as Card) : "—");
  }
  return `Board: ${slots.join(" ")}`;
}

function stateLines(match: MatchState, names: Map<number, string>): string[] {
  const lines = [
    `🃏 Hand #${match.handNo} — ${STREET_LABEL[match.street]} · 💰 Pot ${formatAmount(
      match.pot,
    )} · cap ${CAP}`,
  ];
  const board = boardText(match.board);
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

export function activityText(view: ActivityView): string {
  const lines = [`<b>${headline(view)}</b>`, "", ...stateLines(view.match, view.names)];
  const next = nextLine(view.match, view.names);
  if (next !== null) {
    lines.push("", next);
  }
  return lines.join("\n");
}

export function resultText(
  match: MatchState,
  names: Map<number, string>,
  shown: Map<number, [Card, Card]>,
): string {
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
    .map((id) => match.players.find((player) => player.userId === id)?.hole)
    .filter((hole): hole is [Card, Card] => hole !== undefined);
  if (winnerCards.length > 0) {
    line += ` — ${winnerCards.map((hole) => cardsText(hole)).join(" / ")}`;
  }
  const lines = [line];
  const board = boardText(match.board);
  if (board) {
    lines.push(board);
  }
  for (const [userId, hole] of shown) {
    lines.push(`👁 ${nameOf(names, userId)} shows ${cardsText(hole)}`);
  }
  return lines.join("\n");
}

export function dmCardsText(handNo: number, hole: [Card, Card]): string {
  return [
    `🂠 <b>Your hand — Hand #${handNo}</b>`,
    cardsText(hole),
    "",
    "Board and betting happen in the group.",
  ].join("\n");
}

export function errorBox(text: string): string {
  return `<i>${escapeHtml(text)}</i>`;
}

export function lobbyExpiredAlert(): string {
  return "This lobby is no longer open. Start a new match with /newmatch.";
}

export function notInMatchAlert(): string {
  return "You're not in this match";
}

export function notYourTurnAlert(name: string): string {
  return `It's ${name}'s turn`;
}

export function staleMoveAlert(): string {
  return "That move is no longer available";
}

export function needDmAlert(): string {
  return "You need to open my DM first so I can send your cards.";
}

export function joinedDmText(): string {
  return "You're in! I'll DM your cards when the hand starts.";
}

export function noMatchAlert(): string {
  return "There is no open match.";
}

export function matchOpenAlert(): string {
  return "A match is already open";
}

export function matchActiveAlert(): string {
  return "A match is in progress. Finish it first.";
}

export function needBalanceAlert(): string {
  return `You need at least ${MIN_JOIN_BALANCE} ${CURRENCY_NAME} to play. Claim with /daily.`;
}

export function tableFullAlert(): string {
  return `Table is full (${MAX_PLAYERS}/${MAX_PLAYERS})`;
}

export function alreadyJoinedAlert(): string {
  return "You're already in.";
}

export function onlyStarterAlert(): string {
  return "Only the starter can do that.";
}

export function takeoverAlert(): string {
  return "You can't take over right now.";
}

export function cardsNoneAlert(): string {
  return "You're not holding cards right now.";
}

export function showNoneAlert(): string {
  return "There's nothing to show.";
}

export function glitchAlert(): string {
  return "Something glitched. Try again.";
}

export function amountMultipleAlert(): string {
  return "Amounts are multiples of 10";
}

export function raiseCapAlert(maxTo: number): string {
  return `You can raise to at most ${formatAmount(maxTo)}`;
}

export function noRaiseAlert(): string {
  return "You can't raise right now.";
}

export const DAILY_AMOUNT_TEXT = DAILY_AMOUNT;

export interface BalanceView {
  balance: number;
  lastDailyAt: number | null;
  handsPlayed: number;
  handsWon: number;
  chipsWon: number;
  chipsLost: number;
  now: number;
}

export interface StatsView extends BalanceView {
  biggestPot: number;
  bestHand: string | null;
}

export function dailyClaimedText(balance: number): string {
  return `✅ +${DAILY_AMOUNT_TEXT} chips claimed. Balance: ${formatAmount(balance)}. Next claim in 24h.`;
}

export function dailyTooEarlyText(remainingMs: number): string {
  return `⏳ Already claimed. Next claim in ${formatDuration(remainingMs)}.`;
}

export function dailyTeaserText(name: string): string {
  return `🎁 ${escapeHtml(name)} claimed their daily chips.`;
}

export function dailyStatus(lastDailyAt: number | null, now: number, cooldownMs: number): string {
  if (lastDailyAt === null || now - lastDailyAt >= cooldownMs) {
    return "ready now";
  }
  return `next in ${formatDuration(cooldownMs - (now - lastDailyAt))}`;
}

export function balanceText(view: BalanceView, cooldownMs: number): string {
  const net = view.chipsWon - view.chipsLost;
  return [
    `💰 Balance: ${formatAmount(view.balance)} ${CURRENCY_NAME}`,
    `🌅 Daily: ${dailyStatus(view.lastDailyAt, view.now, cooldownMs)}`,
    `📈 Record: ${view.handsPlayed} hands · ${view.handsWon} wins · ${
      net >= 0 ? "+" : ""
    }${formatAmount(net)} ${CURRENCY_NAME}`,
  ].join("\n");
}

export function statsText(player: StatsView, groupTitle: string | null): string {
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
}

export interface HistoryView {
  handNo: number;
  won: boolean;
  delta: number;
  hole: Card[] | null;
  board: Card[];
}

export function historyText(rows: HistoryView[]): string {
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
}

export interface LeaderboardRow {
  firstName: string;
  balance: number;
}

export function leaderboardText(rows: LeaderboardRow[], groupTitle: string | null): string {
  const lines = [`🏆 <b>Leaderboard${groupTitle ? ` — ${escapeHtml(groupTitle)}` : ""}</b>`];
  if (rows.length === 0) {
    lines.push("No chips claimed yet.");
    return lines.join("\n");
  }
  rows.forEach((row, index) => {
    lines.push(`${index + 1}. ${escapeHtml(row.firstName)}  ${formatAmount(row.balance)}`);
  });
  return lines.join("\n");
}

export function versionText(version: string, webhookUrl: string | null, pending: number): string {
  return [
    `🤖 dailypoker.bot v${version}`,
    `Webhook: ${webhookUrl ?? "not set"}`,
    `Pending updates: ${pending}`,
  ].join("\n");
}

export function resetGroupConfirmText(chatId: number): string {
  return `⚠️ This wipes all players, balances and history for ${chatId}.\nSend /resetgroup confirm ${chatId} to proceed.`;
}

export function resetGroupDoneText(chatId: number): string {
  return `🧹 Group ${chatId} wiped.`;
}

export function ownerOnlyText(): string {
  return "Owner only.";
}
