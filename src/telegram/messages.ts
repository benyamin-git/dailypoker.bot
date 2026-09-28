import { ANTE, CAP, CURRENCY_NAME, MAX_PLAYERS, MIN_JOIN_BALANCE } from "../config";
import type { Card, MatchState, PlayerState } from "../engine/types";

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

export function boardLine(board: readonly Card[]): string {
  const slots: string[] = [];
  for (let i = 0; i < 5; i++) {
    slots.push(board[i] ? cardText(board[i] as Card) : "—");
  }
  return `Board: ${slots.join(" ")}`;
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
    `Ante ${ANTE} · Cap ${CAP} · 2–${MAX_PLAYERS} players`,
    "",
    `Starter: ${starter}`,
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

export interface TableView {
  match: MatchState;
  names: Map<number, string>;
  secondsLeft: number | null;
}

function statusLine(view: TableView, player: PlayerState): string {
  const name = nameOf(view.names, player.userId).padEnd(12).slice(0, 12);
  if (player.folded) {
    return `✖ ${name} folded`;
  }
  if (player.allIn) {
    return `👤 ${name} ALL-IN (${CAP})`;
  }
  const room = CAP - player.contribution;
  const call = Math.max(0, view.match.currentBet - player.streetContribution);
  const isActor = view.match.actorUserId === player.userId;
  const prefix = isActor ? "🎯" : "👤";
  const callText = call > 0 ? ` · to call ${call}` : " · to call 0";
  const timer = isActor && view.secondsLeft !== null ? `  ⏳ ${view.secondsLeft}s` : "";
  return `${prefix} ${name} room ${room}${callText}${timer}`;
}

export function tableText(view: TableView): string {
  const { match } = view;
  const lines = [
    `🃏 <b>Daily Poker — Hand #${match.handNo}</b>`,
    `Ante ${ANTE} · Pot ${formatAmount(match.pot)} · Cap ${CAP}`,
    "",
    "<pre>",
  ];
  const seated = match.order
    .map((userId) => match.players.find((player) => player.userId === userId))
    .filter((player): player is PlayerState => player !== undefined);
  for (const player of seated) {
    lines.push(statusLine(view, player));
  }
  lines.push("</pre>", "");
  if (match.revealed) {
    for (const player of match.players) {
      if (!player.folded && player.hole) {
        lines.push(`👁 ${nameOf(view.names, player.userId)}: ${cardsText(player.hole)}`);
      }
    }
    lines.push("");
  }
  lines.push(boardLine(match.board));
  return lines.join("\n");
}

export function resultText(
  match: MatchState,
  names: Map<number, string>,
  shown: Map<number, [Card, Card]>,
): string {
  const winners = match.winners.map((id) => nameOf(names, id)).join(", ");
  const lines = [
    `🏆 <b>${winners} ${match.winners.length === 1 ? "wins" : "split"} ${formatAmount(match.pot)}</b>`,
  ];
  const winnerCards = match.winners
    .map((id) => match.players.find((player) => player.userId === id)?.hole)
    .filter((hole): hole is [Card, Card] => hole !== undefined);
  if (winnerCards.length > 0) {
    lines[0] += ` — ${winnerCards.map((hole) => cardsText(hole)).join(" / ")}`;
  }
  lines.push(boardLine(match.board));
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
