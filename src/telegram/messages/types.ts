import type { ActionKind, Card, MatchState, Street } from "../../engine/types";

export type Lang = "en" | "fa";

export const LANGS: readonly Lang[] = ["en", "fa"];

export type TableActivity =
  | { type: "start" }
  | { type: "action"; userId: number; kind: ActionKind; to: number | null }
  | { type: "timeout"; userId: number; kind: "check" | "fold" }
  | { type: "street"; street: Street; cards: Card[] };

export interface LobbyView {
  names: Map<number, string>;
  starterId: number | null;
  playerIds: number[];
  error?: string | null;
  expired?: boolean;
}

export interface ActivityView {
  match: MatchState;
  names: Map<number, string>;
  activity: TableActivity;
}

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

export interface HistoryView {
  handNo: number;
  won: boolean;
  delta: number;
  hole: Card[] | null;
  board: Card[];
}

export interface LeaderboardRow {
  firstName: string;
  balance: number;
}

export interface KeyboardLabels {
  join: string;
  leave: string;
  takeover: string;
  deal: string;
  cancel: string;
  openBot: string;
  cards: string;
  fold: string;
  check: string;
  call: (amount: number) => string;
  raise: string;
  bet: (amount: number) => string;
  raiseTo: (to: number) => string;
  allIn: (to: number) => string;
  showHand: string;
  rematch: string;
  resetGroup: string;
}

export interface Messages {
  labels: KeyboardLabels;

  pingText(): string;
  unknownGroupText(): string;
  welcomeText(): string;
  helpText(isDm: boolean): string;
  rulesText(): string;

  lobbyText(view: LobbyView): string;
  lobbyStartedText(handNo: number): string;
  activityText(view: ActivityView): string;
  resultText(
    match: MatchState,
    names: Map<number, string>,
    shown: Map<number, [Card, Card]>,
  ): string;
  dmCardsText(handNo: number, hole: [Card, Card]): string;

  lobbyExpiredAlert(): string;
  notInMatchAlert(): string;
  notYourTurnAlert(name: string): string;
  staleMoveAlert(): string;
  needDmAlert(): string;
  joinedDmText(): string;
  noMatchAlert(): string;
  matchOpenAlert(): string;
  matchActiveAlert(): string;
  needBalanceAlert(): string;
  tableFullAlert(): string;
  alreadyJoinedAlert(): string;
  onlyStarterAlert(): string;
  takeoverAlert(): string;
  cardsNoneAlert(): string;
  showNoneAlert(): string;
  glitchAlert(): string;
  amountMultipleAlert(): string;
  raiseCapAlert(maxTo: number): string;
  noRaiseAlert(): string;

  raiseTypeText(): string;
  raisePickText(): string;
  yourHandAlert(cards: string): string;
  inAlert(): string;
  lobbyClosedText(): string;
  lobbyCanceledText(): string;
  needMorePlayersError(): string;
  playerBrokeError(name: string): string;
  nothingPendingText(): string;
  resetGroupPromptText(groupTitle: string | null, chatId: number): string;
  resetGroupArmedText(): string;
  resetGroupMismatchText(): string;

  dailyClaimedText(balance: number): string;
  dailyTooEarlyText(remainingMs: number): string;
  dailyTeaserText(name: string): string;
  dailyStatus(lastDailyAt: number | null, now: number, cooldownMs: number): string;
  balanceText(view: BalanceView, cooldownMs: number): string;
  statsText(player: StatsView, groupTitle: string | null): string;
  historyText(rows: HistoryView[]): string;
  leaderboardText(rows: LeaderboardRow[], groupTitle: string | null): string;
  versionText(version: string, webhookUrl: string | null, pending: number): string;
  resetGroupDoneText(chatId: number): string;
  ownerOnlyText(): string;

  languageSetText(lang: Lang): string;
}
