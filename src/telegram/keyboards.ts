import { BET_MULTIPLE, MIN_BET_STEP } from "../config";
import { maxRaiseTo, minFullRaiseTo } from "../engine/hand";
import type { MatchState, PlayerState } from "../engine/types";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "./api";
import type { KeyboardLabels } from "./messages/types";

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

export function lobbyKeyboard(
  options: {
    matchId: number;
    botUsername: string;
    takeoverAvailable: boolean;
  },
  labels: KeyboardLabels,
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [
    [
      { text: labels.join, callback_data: callbackData(options.matchId, 0, "join") },
      { text: labels.leave, callback_data: callbackData(options.matchId, 0, "leave") },
    ],
  ];
  if (options.takeoverAvailable) {
    rows.push([
      { text: labels.takeover, callback_data: callbackData(options.matchId, 0, "takeover") },
    ]);
  } else {
    rows.push([
      { text: labels.deal, callback_data: callbackData(options.matchId, 0, "deal") },
      { text: labels.cancel, callback_data: callbackData(options.matchId, 0, "cancel") },
    ]);
  }
  rows.push([
    {
      text: labels.openBot,
      url: `https://t.me/${options.botUsername}?start=join_${options.matchId}`,
    },
  ]);
  return { inline_keyboard: rows };
}

export interface RaiseOption {
  label: string;
  kind: "bet" | "raise" | "allin";
  to?: number;
}

const RAISE_ROW_SIZE = 5;

export function raiseOptions(
  state: MatchState,
  player: PlayerState,
  labels: KeyboardLabels,
): RaiseOption[] {
  const options: RaiseOption[] = [];
  const maxTo = maxRaiseTo(state, player);
  if (state.currentBet === 0) {
    for (let to = MIN_BET_STEP; to <= maxTo; to += BET_MULTIPLE) {
      options.push({ label: labels.bet(to), kind: "bet", to });
    }
  } else {
    const minRaise = minFullRaiseTo(state, player);
    if (minRaise !== null) {
      for (let to = minRaise; to <= maxTo; to += BET_MULTIPLE) {
        options.push({ label: labels.raiseTo(to), kind: "raise", to });
      }
    }
  }
  if (maxTo > state.currentBet && !options.some((option) => option.to === maxTo)) {
    options.push({ label: labels.allIn(maxTo), kind: "allin", to: maxTo });
  }
  return options;
}

export function tableKeyboard(
  options: {
    matchId: number;
    turnId: number;
    state: MatchState;
    actor: PlayerState | null;
  },
  labels: KeyboardLabels,
): InlineKeyboardMarkup {
  const { matchId, turnId, state, actor } = options;
  const cards: InlineKeyboardButton = {
    text: labels.cards,
    callback_data: callbackData(matchId, turnId, "cards"),
  };
  if (!actor || state.status !== "active" || state.actorUserId === null) {
    return { inline_keyboard: [[cards]] };
  }
  const toCall = Math.max(0, state.currentBet - actor.streetContribution);
  const row: InlineKeyboardButton[] = [
    { text: labels.fold, callback_data: callbackData(matchId, turnId, "fold") },
  ];
  if (toCall === 0) {
    row.push({ text: labels.check, callback_data: callbackData(matchId, turnId, "check") });
  } else {
    row.push({ text: labels.call(toCall), callback_data: callbackData(matchId, turnId, "call") });
  }
  const raiseMenu = raiseOptions(state, actor, labels).some((option) => option.to !== undefined);
  if (raiseMenu) {
    row.push({ text: labels.raise, callback_data: callbackData(matchId, turnId, "raise") });
  }
  row.push(cards);
  return { inline_keyboard: [row] };
}

export function raiseKeyboard(options: {
  matchId: number;
  turnId: number;
  options: RaiseOption[];
}): InlineKeyboardMarkup {
  const buttons: InlineKeyboardButton[] = options.options.map((option) => ({
    text: option.label,
    callback_data: callbackData(options.matchId, options.turnId, option.kind, option.to),
  }));
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < buttons.length; i += RAISE_ROW_SIZE) {
    rows.push(buttons.slice(i, i + RAISE_ROW_SIZE));
  }
  return { inline_keyboard: rows };
}

export function resultKeyboard(matchId: number, labels: KeyboardLabels): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: labels.showHand, callback_data: callbackData(matchId, 0, "show") },
        { text: labels.rematch, callback_data: callbackData(matchId, 0, "rematch") },
      ],
    ],
  };
}
