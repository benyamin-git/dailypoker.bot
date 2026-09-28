import { BET_MULTIPLE } from "../config";
import { maxRaiseTo, minFullRaiseTo } from "../engine/hand";
import type { MatchState, PlayerState } from "../engine/types";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "./api";

export function callbackData(
  matchId: number,
  turnId: number,
  action: string,
  amount?: number,
): string {
  return amount === undefined
    ? `m:${matchId}:${turnId}:${action}`
    : `m:${matchId}:${turnId}:${action}:${amount}`;
}

export function lobbyKeyboard(options: {
  matchId: number;
  botUsername: string;
  takeoverAvailable: boolean;
}): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [
    [
      { text: "Join", callback_data: callbackData(options.matchId, 0, "join") },
      { text: "Leave", callback_data: callbackData(options.matchId, 0, "leave") },
    ],
  ];
  if (options.takeoverAvailable) {
    rows.push([
      { text: "🙋 Take over", callback_data: callbackData(options.matchId, 0, "takeover") },
    ]);
  } else {
    rows.push([
      { text: "🚀 Deal", callback_data: callbackData(options.matchId, 0, "deal") },
      { text: "Cancel", callback_data: callbackData(options.matchId, 0, "cancel") },
    ]);
  }
  rows.push([
    {
      text: "📬 Open bot",
      url: `https://t.me/${options.botUsername}?start=join_${options.matchId}`,
    },
  ]);
  return { inline_keyboard: rows };
}

export interface RaiseOption {
  label: string;
  kind: "bet" | "raise" | "allin" | "custom";
  to?: number;
}

export function raiseOptions(state: MatchState, player: PlayerState): RaiseOption[] {
  const options: RaiseOption[] = [];
  const maxTo = maxRaiseTo(state, player);
  if (state.currentBet === 0) {
    if (maxTo >= BET_MULTIPLE) {
      options.push({ label: `Bet ${BET_MULTIPLE}`, kind: "bet", to: BET_MULTIPLE });
    }
  } else {
    const minRaise = minFullRaiseTo(state, player);
    if (minRaise !== null) {
      options.push({ label: `Min — to ${minRaise}`, kind: "raise", to: minRaise });
      const nextStep = minRaise + BET_MULTIPLE;
      if (nextStep <= maxTo) {
        options.push({ label: `+${BET_MULTIPLE} — to ${nextStep}`, kind: "raise", to: nextStep });
      }
    }
  }
  if (maxTo > state.currentBet && !options.some((option) => option.to === maxTo)) {
    options.push({ label: `All-in — ${maxTo}`, kind: "allin", to: maxTo });
  }
  options.push({ label: "✏️ Custom", kind: "custom" });
  return options;
}

export function tableKeyboard(options: {
  matchId: number;
  turnId: number;
  state: MatchState;
  actor: PlayerState | null;
}): InlineKeyboardMarkup {
  const { matchId, turnId, state, actor } = options;
  const cards: InlineKeyboardButton = {
    text: "🂠 Cards",
    callback_data: callbackData(matchId, turnId, "cards"),
  };
  if (!actor || state.status !== "active" || state.actorUserId === null) {
    return { inline_keyboard: [[cards]] };
  }
  const toCall = Math.max(0, state.currentBet - actor.streetContribution);
  const row: InlineKeyboardButton[] = [
    { text: "Fold", callback_data: callbackData(matchId, turnId, "fold") },
  ];
  if (toCall === 0) {
    row.push({ text: "Check", callback_data: callbackData(matchId, turnId, "check") });
  } else {
    row.push({ text: `Call ${toCall}`, callback_data: callbackData(matchId, turnId, "call") });
  }
  const raiseMenu = raiseOptions(state, actor).some((option) => option.to !== undefined);
  if (raiseMenu) {
    row.push({ text: "Raise ▾", callback_data: callbackData(matchId, turnId, "raise") });
  }
  row.push(cards);
  return { inline_keyboard: [row] };
}

export function raiseKeyboard(options: {
  matchId: number;
  turnId: number;
  options: RaiseOption[];
}): InlineKeyboardMarkup {
  const row: InlineKeyboardButton[] = [];
  for (const option of options.options) {
    row.push({
      text: option.label,
      callback_data: callbackData(options.matchId, options.turnId, option.kind, option.to),
    });
  }
  return { inline_keyboard: [row] };
}

export function resultKeyboard(matchId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "Show my hand", callback_data: callbackData(matchId, 0, "show") },
        { text: "🔁 Rematch", callback_data: callbackData(matchId, 0, "rematch") },
      ],
    ],
  };
}
