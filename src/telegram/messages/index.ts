import { en } from "./en";
import { fa } from "./fa";
import type { Lang, Messages } from "./types";

export function getMessages(lang: Lang): Messages {
  return lang === "fa" ? fa : en;
}

export function normalizeLang(value: string | null | undefined): Lang {
  return value === "fa" ? "fa" : "en";
}

export { cardsText, cardText, errorBox, escapeHtml, formatAmount } from "./shared";
export type {
  ActivityView,
  BalanceView,
  HistoryView,
  KeyboardLabels,
  Lang,
  LeaderboardRow,
  LobbyView,
  Messages,
  StatsView,
  TableActivity,
} from "./types";
