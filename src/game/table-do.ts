import { DurableObject } from "cloudflare:workers";

import {
  ANTE,
  DAILY_AMOUNT,
  DAILY_COOLDOWN_MS,
  LOBBY_TTL_MS,
  MAX_PLAYERS,
  MIN_JOIN_BALANCE,
  MIN_PLAYERS,
  RUNOUT_STEP_MS,
  TURN_SECONDS,
} from "../config";
import { evaluate7 } from "../engine/evaluator";
import {
  advanceRunout,
  applyAction,
  createMatch,
  EngineError,
  legalActions,
  maxRaiseTo,
  playerById,
  revealHand,
  startHand,
  timeoutAction,
} from "../engine/hand";
import type { Action, Card, EngineResult, MatchState, PlayerState, Street } from "../engine/types";
import type { AppConfig, Bindings } from "../env";
import { getConfig } from "../env";
import { type InlineKeyboardMarkup, TelegramApi } from "../telegram/api";
import {
  chatIdOf,
  classifyUpdate,
  type Intent,
  parseCallbackData,
  type TelegramUser,
  updateSchema,
} from "../telegram/bot";
import {
  lobbyKeyboard,
  raiseKeyboard,
  raiseOptions,
  resultKeyboard,
  tableKeyboard,
} from "../telegram/keyboards";
import * as messages from "../telegram/messages";
import { hashId, safeErrorMessage } from "../util/log";
import * as store from "./store";

const STATE_KEY = "table_state";
const STATE_VERSION = 1;

interface LobbyState {
  matchId: number;
  starterId: number | null;
  playerIds: number[];
  createdAt: number;
  deadlineAt: number;
  messageId: number | null;
  error: string | null;
}

interface LogAction {
  t: number;
  user: number;
  street: number;
  kind: string;
  to: number | null;
}

interface TableState {
  version: number;
  lobby: LobbyState | null;
  match: MatchState | null;
  actionLog: LogAction[];
  tableMessageId: number | null;
  resultMessageId: number | null;
  turnDeadlineAt: number | null;
  runoutDeadlineAt: number | null;
  effectsSent: boolean;
  updatedAt: number;
}

function emptyState(): TableState {
  return {
    version: STATE_VERSION,
    lobby: null,
    match: null,
    actionLog: [],
    tableMessageId: null,
    resultMessageId: null,
    turnDeadlineAt: null,
    runoutDeadlineAt: null,
    effectsSent: false,
    updatedAt: 0,
  };
}

const STREET_INDEX: Record<Street, number> = {
  preflop: 0,
  flop: 1,
  turn: 2,
  river: 3,
  showdown: 4,
};

const ACTIVE_STATUSES = new Set(["member", "administrator", "creator"]);

type CommandIntent = Extract<Intent, { kind: "command" }>;
type CallbackIntent = Extract<Intent, { kind: "callback" }>;
type ChatMemberIntent = Extract<Intent, { kind: "chat_member" }>;

interface ActionContext {
  source: "command" | "callback" | "dm";
  callbackId?: string;
  matchId?: number;
  turnId?: number;
}

export class TableDO extends DurableObject<Bindings> {
  private readonly sql: SqlStorage;
  private readonly config: AppConfig;
  private readonly api: TelegramApi;
  private state: TableState = emptyState();

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.config = getConfig(env as unknown as Record<string, unknown>);
    this.api = new TelegramApi(this.config.botToken);
    ctx.blockConcurrencyWhile(async () => {
      store.runMigrations(this.sql);
      this.state = this.loadState();
    });
  }

  private loadState(): TableState {
    const raw = store.getMeta(this.sql, STATE_KEY);
    if (raw === null) {
      return emptyState();
    }
    try {
      const parsed = JSON.parse(raw) as TableState;
      if (parsed.version !== STATE_VERSION) {
        return emptyState();
      }
      return { ...emptyState(), ...parsed };
    } catch {
      return emptyState();
    }
  }

  private get groupId(): number {
    return this.config.allowedChatIds[0] as number;
  }

  private persist(): void {
    this.state.updatedAt = Date.now();
    store.setMeta(this.sql, STATE_KEY, JSON.stringify(this.state));
  }

  override async fetch(request: Request): Promise<Response> {
    const raw = await request.text();
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return new Response("ok");
    }
    const parsed = updateSchema.safeParse(json);
    if (!parsed.success) {
      return new Response("ok");
    }
    const update = parsed.data;
    const now = Date.now();
    if (store.isUpdateProcessed(this.sql, update.update_id)) {
      return new Response("ok");
    }
    store.markUpdateProcessed(this.sql, update.update_id, now);
    store.maybePruneUpdates(this.sql, now);

    this.api.resetPerUpdate();
    try {
      await this.handleIntent(classifyUpdate(update));
      await this.api.flushEdits();
      await this.scheduleAlarm();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "update_error",
          updateId: update.update_id,
          chat: hashId(chatIdOf(update) ?? "?"),
          error: safeErrorMessage(error),
        }),
      );
      return new Response("error", { status: 500 });
    }
    return new Response("ok");
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    this.api.resetPerUpdate();
    try {
      const lobby = this.state.lobby;
      if (lobby !== null && lobby.deadlineAt <= now) {
        await this.expireLobby(now);
      }
      if (this.state.match && this.state.match.status === "active") {
        if (this.state.turnDeadlineAt !== null && this.state.turnDeadlineAt <= now) {
          await this.applyTimeout(now);
        }
        if (
          this.state.match &&
          this.state.match.status === "active" &&
          this.state.runoutDeadlineAt !== null &&
          this.state.runoutDeadlineAt <= now
        ) {
          await this.runoutStep(now);
        }
      }
      await this.api.flushEdits();
    } catch (error) {
      console.error(JSON.stringify({ event: "alarm_error", error: safeErrorMessage(error) }));
    }
    this.persist();
    await this.scheduleAlarm();
  }

  private async scheduleAlarm(): Promise<void> {
    const times: number[] = [];
    if (this.state.turnDeadlineAt !== null) {
      times.push(this.state.turnDeadlineAt);
    }
    if (this.state.runoutDeadlineAt !== null) {
      times.push(this.state.runoutDeadlineAt);
    }
    if (this.state.lobby !== null) {
      times.push(this.state.lobby.deadlineAt);
    }
    if (times.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(...times));
  }

  private async handleIntent(intent: Intent): Promise<void> {
    if (intent.kind === "unsupported") {
      return;
    }
    if (intent.kind === "chat_member") {
      await this.handleChatMember(intent);
      return;
    }
    if (intent.chatType === "channel") {
      return;
    }
    const isAllowed =
      intent.chatType === "private" || this.config.allowedChatIds.includes(intent.chatId);
    if (!isAllowed) {
      await this.replyUnknownGroupOnce(intent.chatId);
      return;
    }
    if (
      intent.chatType !== "private" &&
      store.getMeta(this.sql, `group_active:${intent.chatId}`) === "0"
    ) {
      return;
    }
    store.ensurePlayer(this.sql, intent.user, Date.now());
    if (intent.chatType !== "private" && intent.chatTitle !== null) {
      store.setMeta(this.sql, "group_title", intent.chatTitle);
    }
    if (intent.kind === "command") {
      await this.handleCommand(intent);
      return;
    }
    if (intent.kind === "callback") {
      await this.handleCallback(intent);
    }
  }

  private async handleChatMember(intent: ChatMemberIntent): Promise<void> {
    const active = ACTIVE_STATUSES.has(intent.newStatus);
    store.setMeta(this.sql, `group_active:${intent.chatId}`, active ? "1" : "0");
    if (active && intent.chatType !== "private") {
      await this.replyUnknownGroupOnce(intent.chatId);
      return;
    }
    if (!active) {
      this.state.turnDeadlineAt = null;
      this.state.runoutDeadlineAt = null;
      if (this.state.lobby) {
        this.state.lobby.deadlineAt = Date.now();
      }
      this.persist();
    }
  }

  private async replyUnknownGroupOnce(chatId: number): Promise<void> {
    const key = `unknown_group_notified:${chatId}`;
    if (store.getMeta(this.sql, key) !== null) {
      return;
    }
    store.setMeta(this.sql, key, "1");
    await this.api.sendMessage(chatId, messages.unknownGroupText());
  }

  private namesFor(userIds: number[]): Map<number, string> {
    const names = new Map<number, string>();
    for (const userId of userIds) {
      const player = store.getPlayer(this.sql, userId);
      names.set(userId, player?.first_name ?? `user ${userId}`);
    }
    return names;
  }

  private async privateAlert(userId: number, text: string): Promise<void> {
    try {
      await this.api.sendMessage(userId, messages.errorBox(text));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "private_alert_failed",
          user: userId,
          error: safeErrorMessage(error),
        }),
      );
    }
  }

  private async failAction(
    context: ActionContext,
    userId: number,
    text: string,
    showAlert = true,
  ): Promise<void> {
    if (context.source === "callback" && context.callbackId) {
      await this.api.answerCallbackQuery(context.callbackId, { text, show_alert: showAlert });
      return;
    }
    await this.privateAlert(userId, text);
  }

  private async handleCommand(intent: CommandIntent): Promise<void> {
    const { command, args, userId } = intent;
    if (intent.isDm) {
      switch (command) {
        case "start":
          await this.handleStart(intent, args);
          return;
        case "rules":
          await this.api.sendMessage(intent.chatId, messages.rulesText());
          return;
        case "help":
          await this.api.sendMessage(intent.chatId, messages.helpText(true));
          return;
        case "ping":
          await this.api.sendMessage(intent.chatId, messages.pingText());
          return;
        case "cards":
          await this.dmCards(userId);
          return;
        case "daily":
          await this.handleDaily(intent);
          return;
        case "balance":
          await this.sendBalance(intent.chatId, userId);
          return;
        case "stats":
          await this.sendStats(intent.chatId, userId);
          return;
        case "history":
          await this.sendHistory(intent.chatId, userId, args);
          return;
        case "version":
          await this.sendVersion(intent);
          return;
        case "resetgroup":
          await this.resetGroup(intent);
          return;
        default:
          await this.api.sendMessage(intent.chatId, messages.helpText(true));
          return;
      }
    }

    const context: ActionContext = { source: "command" };
    switch (command) {
      case "ping":
        await this.api.sendMessage(intent.chatId, messages.pingText());
        return;
      case "newmatch":
        await this.openLobby(intent.user);
        return;
      case "join":
        await this.joinLobby(intent.user, context);
        return;
      case "leave":
        await this.leaveLobby(intent.user, context);
        return;
      case "deal":
        await this.deal(intent.user, context);
        return;
      case "cancel":
        await this.cancelLobby(intent.user, context);
        return;
      case "takeover":
        await this.takeover(intent.user, context);
        return;
      case "fold":
      case "check":
      case "call":
      case "allin":
        await this.betting(userId, { kind: command }, context);
        return;
      case "raise": {
        const amount = Number(args.trim());
        if (!Number.isSafeInteger(amount) || amount <= 0) {
          await this.privateAlert(userId, "Type /raise <amount> (multiples of 10).");
          return;
        }
        if (amount % 10 !== 0) {
          await this.privateAlert(userId, messages.amountMultipleAlert());
          return;
        }
        await this.betting(userId, { kind: "raise", to: amount }, context);
        return;
      }
      case "show":
        await this.showHand(userId);
        return;
      case "cards":
        await this.dmCards(userId);
        return;
      case "balance":
        await this.sendBalance(intent.chatId, userId);
        return;
      case "top":
        await this.sendLeaderboard(intent.chatId);
        return;
      case "stats":
        await this.sendStats(userId, userId);
        return;
      case "history":
        await this.sendHistory(userId, userId, args);
        return;
      case "rules":
        await this.api.sendMessage(intent.chatId, messages.rulesText());
        return;
      case "help":
        await this.api.sendMessage(intent.chatId, messages.helpText(false));
        return;
      default:
        return;
    }
  }

  private async handleCallback(intent: CallbackIntent): Promise<void> {
    const data = parseCallbackData(intent.data);
    const userId = intent.userId;
    if (!data) {
      await this.api.answerCallbackQuery(intent.callbackId, {
        text: messages.staleMoveAlert(),
      });
      return;
    }
    const context: ActionContext = {
      source: "callback",
      callbackId: intent.callbackId,
      matchId: data.matchId,
      turnId: data.turnId,
    };
    const requireLobby = async (): Promise<boolean> => {
      if (!this.lobbyMatches(data.matchId)) {
        await this.api.answerCallbackQuery(intent.callbackId, {
          text: messages.lobbyExpiredAlert(),
        });
        return false;
      }
      return true;
    };
    switch (data.action) {
      case "join": {
        if (!(await requireLobby())) return;
        await this.joinLobby(intent.user, context);
        return;
      }
      case "leave": {
        if (!(await requireLobby())) return;
        await this.leaveLobby(intent.user, context);
        return;
      }
      case "deal": {
        if (!(await requireLobby())) return;
        await this.deal(intent.user, context);
        return;
      }
      case "cancel": {
        if (!(await requireLobby())) return;
        await this.cancelLobby(intent.user, context);
        return;
      }
      case "takeover": {
        if (!(await requireLobby())) return;
        await this.takeover(intent.user, context);
        return;
      }
      case "fold":
      case "check":
      case "call":
        await this.betting(userId, { kind: data.action }, context);
        return;
      case "bet":
      case "raise": {
        if (data.amount === undefined) {
          const match = this.state.match;
          const player = match?.players.find((candidate) => candidate.userId === userId);
          if (
            match === null ||
            match.status !== "active" ||
            match.matchId !== data.matchId ||
            match.turnId !== data.turnId
          ) {
            await this.api.answerCallbackQuery(intent.callbackId, {
              text: messages.staleMoveAlert(),
            });
            return;
          }
          if (!player) {
            await this.api.answerCallbackQuery(intent.callbackId, {
              text: messages.notInMatchAlert(),
            });
            return;
          }
          if (match.actorUserId !== userId) {
            const actorId = match.actorUserId as number;
            const actorName = this.namesFor([actorId]).get(actorId) as string;
            await this.api.answerCallbackQuery(intent.callbackId, {
              text: messages.notYourTurnAlert(actorName),
            });
            return;
          }
          if (this.state.tableMessageId !== null) {
            this.editTableMessage(
              Date.now(),
              raiseKeyboard({
                matchId: match.matchId,
                turnId: match.turnId,
                options: raiseOptions(match, player),
              }),
            );
          }
          await this.api.answerCallbackQuery(intent.callbackId, {
            text: "Pick an amount or type /raise <amount>.",
            show_alert: true,
          });
          return;
        }
        await this.betting(userId, { kind: data.action, to: data.amount }, context);
        return;
      }
      case "allin":
        await this.betting(userId, { kind: "allin" }, context);
        return;
      case "raisecustom":
        await this.api.answerCallbackQuery(intent.callbackId, {
          text: "Type /raise <amount> (multiples of 10).",
          show_alert: true,
        });
        return;
      case "cards": {
        const player = this.state.match?.players.find((candidate) => candidate.userId === userId);
        if (!player?.hole) {
          await this.api.answerCallbackQuery(intent.callbackId, {
            text: messages.cardsNoneAlert(),
          });
          return;
        }
        await this.api.answerCallbackQuery(intent.callbackId, {
          text: `Your hand: ${messages.cardsText(player.hole)}`,
          show_alert: true,
        });
        return;
      }
      case "show": {
        if (this.state.match?.matchId !== data.matchId || this.state.match.status !== "done") {
          await this.api.answerCallbackQuery(intent.callbackId, {
            text: messages.showNoneAlert(),
          });
          return;
        }
        await this.showHand(userId, intent.callbackId);
        return;
      }
      case "rematch": {
        if (this.state.match?.matchId !== data.matchId || this.state.match.status !== "done") {
          await this.api.answerCallbackQuery(intent.callbackId, {
            text: messages.staleMoveAlert(),
          });
          return;
        }
        await this.openLobby(intent.user, intent.callbackId);
        return;
      }
      default:
        await this.api.answerCallbackQuery(intent.callbackId, {
          text: messages.staleMoveAlert(),
        });
    }
  }

  private lobbyMatches(matchId: number): boolean {
    return this.state.lobby !== null && this.state.lobby.matchId === matchId;
  }

  private async handleStart(intent: CommandIntent, payload: string): Promise<void> {
    store.setDmStarted(this.sql, intent.userId);
    const joinMatch = /^join_(\d+)$/.exec(payload.trim());
    if (joinMatch) {
      const matchId = Number(joinMatch[1]);
      if (!this.lobbyMatches(matchId)) {
        await this.api.sendMessage(intent.chatId, messages.lobbyExpiredAlert());
        return;
      }
      await this.joinLobby(intent.user, { source: "dm" });
      return;
    }
    await this.api.sendMessage(intent.chatId, messages.welcomeText());
  }

  private async openLobby(starter: TelegramUser, callbackId?: string): Promise<void> {
    const now = Date.now();
    const reject = async (text: string): Promise<void> => {
      if (callbackId) {
        await this.api.answerCallbackQuery(callbackId, { text, show_alert: true });
      } else {
        await this.privateAlert(starter.id, text);
      }
    };
    if (this.state.lobby !== null) {
      await reject(messages.matchOpenAlert());
      return;
    }
    if (this.state.match !== null && this.state.match.status === "active") {
      await reject(messages.matchActiveAlert());
      return;
    }
    const player = store.ensurePlayer(this.sql, starter, now);
    if (player.balance < MIN_JOIN_BALANCE) {
      await reject(messages.needBalanceAlert());
      return;
    }
    const matchId = store.createMatchRow(this.sql, starter.id, now);
    this.state.match = null;
    this.state.actionLog = [];
    this.state.resultMessageId = null;
    this.state.effectsSent = false;
    this.state.turnDeadlineAt = null;
    this.state.runoutDeadlineAt = null;
    this.state.lobby = {
      matchId,
      starterId: starter.id,
      playerIds: [starter.id],
      createdAt: now,
      deadlineAt: now + LOBBY_TTL_MS,
      messageId: null,
      error: null,
    };
    this.persist();
    await this.sendLobbyMessage();
    if (callbackId) {
      await this.api.answerCallbackQuery(callbackId);
    }
  }

  private async sendLobbyMessage(): Promise<void> {
    const lobby = this.state.lobby;
    if (!lobby) {
      return;
    }
    const names = this.namesFor(lobby.playerIds);
    const text = messages.lobbyText({
      names,
      starterId: lobby.starterId,
      playerIds: lobby.playerIds,
      error: lobby.error,
    });
    const keyboard = lobbyKeyboard({
      matchId: lobby.matchId,
      botUsername: this.config.botUsername,
      takeoverAvailable: lobby.starterId === null,
    });
    const message = await this.api.sendMessage(this.groupId, text, { reply_markup: keyboard });
    if (message) {
      lobby.messageId = message.message_id;
      this.state.tableMessageId = message.message_id;
      try {
        await this.api.pinChatMessage(this.groupId, message.message_id);
      } catch (error) {
        console.error(JSON.stringify({ event: "pin_failed", error: safeErrorMessage(error) }));
      }
    }
    this.persist();
  }

  private async editLobbyMessage(): Promise<void> {
    const lobby = this.state.lobby;
    if (!lobby || lobby.messageId === null) {
      return;
    }
    const names = this.namesFor(lobby.playerIds);
    const text = messages.lobbyText({
      names,
      starterId: lobby.starterId,
      playerIds: lobby.playerIds,
      error: lobby.error,
    });
    const keyboard = lobbyKeyboard({
      matchId: lobby.matchId,
      botUsername: this.config.botUsername,
      takeoverAvailable: lobby.starterId === null,
    });
    this.api.queueEdit(this.groupId, lobby.messageId, text, { reply_markup: keyboard });
  }

  private async joinLobby(user: TelegramUser, context: ActionContext): Promise<void> {
    const now = Date.now();
    const lobby = this.state.lobby;
    if (!lobby) {
      if (context.source === "callback" && context.callbackId) {
        await this.api.answerCallbackQuery(context.callbackId, {
          text: messages.lobbyExpiredAlert(),
        });
      } else {
        await this.privateAlert(user.id, messages.lobbyExpiredAlert());
      }
      return;
    }
    if (lobby.playerIds.includes(user.id)) {
      if (context.source === "callback" && context.callbackId) {
        await this.api.answerCallbackQuery(context.callbackId, {
          text: messages.alreadyJoinedAlert(),
        });
      } else {
        await this.privateAlert(user.id, messages.alreadyJoinedAlert());
      }
      return;
    }
    const player = store.ensurePlayer(this.sql, user, now);
    if (player.balance < MIN_JOIN_BALANCE) {
      await this.failAction(context, user.id, messages.needBalanceAlert());
      return;
    }
    if (lobby.playerIds.length >= MAX_PLAYERS) {
      await this.failAction(context, user.id, messages.tableFullAlert());
      return;
    }
    if (player.dm_started === 0 && context.source === "callback") {
      await this.failAction(context, user.id, messages.needDmAlert());
      return;
    }
    lobby.playerIds.push(user.id);
    lobby.deadlineAt = now + LOBBY_TTL_MS;
    lobby.error = null;
    this.persist();
    await this.editLobbyMessage();
    if (context.source === "callback" && context.callbackId) {
      await this.api.answerCallbackQuery(context.callbackId, { text: "You're in." });
    } else if (context.source === "dm") {
      await this.api.sendMessage(user.id, messages.joinedDmText());
    }
  }

  private async leaveLobby(user: TelegramUser, context: ActionContext): Promise<void> {
    const lobby = this.state.lobby;
    if (!lobby) {
      await this.failAction(context, user.id, messages.lobbyExpiredAlert(), false);
      return;
    }
    if (!lobby.playerIds.includes(user.id)) {
      await this.failAction(context, user.id, messages.notInMatchAlert());
      return;
    }
    lobby.playerIds = lobby.playerIds.filter((id) => id !== user.id);
    if (lobby.starterId === user.id) {
      lobby.starterId = null;
    }
    if (lobby.playerIds.length === 0) {
      store.setMatchStatus(this.sql, lobby.matchId, "canceled", Date.now());
      const messageId = lobby.messageId;
      this.state.lobby = null;
      this.persist();
      if (messageId !== null) {
        this.api.queueEdit(this.groupId, messageId, "Lobby closed.", {});
      }
    } else {
      this.persist();
      await this.editLobbyMessage();
    }
    if (context.source === "callback" && context.callbackId) {
      await this.api.answerCallbackQuery(context.callbackId);
    }
  }

  private async deal(user: TelegramUser, context: ActionContext): Promise<void> {
    const now = Date.now();
    const lobby = this.state.lobby;
    if (!lobby) {
      await this.failAction(context, user.id, messages.lobbyExpiredAlert(), false);
      return;
    }
    if (lobby.starterId === null || user.id !== lobby.starterId) {
      await this.failAction(context, user.id, messages.onlyStarterAlert());
      return;
    }
    if (lobby.playerIds.length < MIN_PLAYERS) {
      lobby.error = "Need at least 2 players to deal.";
      this.persist();
      await this.editLobbyMessage();
      if (context.callbackId) {
        await this.api.answerCallbackQuery(context.callbackId);
      }
      return;
    }
    const names = this.namesFor(lobby.playerIds);
    const broke = lobby.playerIds.find((id) => {
      const player = store.getPlayer(this.sql, id);
      return player === null || player.balance < MIN_JOIN_BALANCE;
    });
    if (broke !== undefined) {
      lobby.error = `${names.get(broke) ?? `user ${broke}`} doesn't have enough chips (needs ${MIN_JOIN_BALANCE}).`;
      this.persist();
      await this.editLobbyMessage();
      if (context.callbackId) {
        await this.api.answerCallbackQuery(context.callbackId);
      }
      return;
    }
    if (context.callbackId) {
      await this.api.answerCallbackQuery(context.callbackId);
    }

    const match = createMatch({
      chatId: this.groupId,
      matchId: lobby.matchId,
      players: lobby.playerIds.map((userId) => ({ userId })),
    });
    match.handNo = store.nextHandNo(this.sql);
    const started = startHand(match);
    const state = started.state;
    store.setMatchStarted(this.sql, lobby.matchId, state.handNo, now);
    for (const player of state.players) {
      store.adjustBalance(this.sql, player.userId, -ANTE);
    }

    this.state.lobby = null;
    this.state.tableMessageId = lobby.messageId;
    this.state.actionLog = [];
    this.state.effectsSent = false;
    this.state.resultMessageId = null;

    for (const event of started.events) {
      if (event.type === "hole_cards") {
        try {
          await this.api.sendMessage(event.userId, messages.dmCardsText(state.handNo, event.cards));
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "dm_cards_failed",
              user: event.userId,
              error: safeErrorMessage(error),
            }),
          );
        }
      }
    }

    this.state.match = state;
    this.resetDeadlines(state, now);
    this.persist();
    this.editTableMessage(now);
    await this.api.flushEdits();
  }

  private async cancelLobby(user: TelegramUser, context: ActionContext): Promise<void> {
    const lobby = this.state.lobby;
    if (!lobby) {
      await this.failAction(context, user.id, messages.lobbyExpiredAlert(), false);
      return;
    }
    if (lobby.starterId === null || user.id !== lobby.starterId) {
      await this.failAction(context, user.id, messages.onlyStarterAlert());
      return;
    }
    store.setMatchStatus(this.sql, lobby.matchId, "canceled", Date.now());
    const messageId = lobby.messageId;
    this.state.lobby = null;
    this.persist();
    if (messageId !== null) {
      this.api.queueEdit(this.groupId, messageId, "Lobby canceled.", {});
    }
    if (context.callbackId) {
      await this.api.answerCallbackQuery(context.callbackId);
    }
  }

  private async takeover(user: TelegramUser, context: ActionContext): Promise<void> {
    const lobby = this.state.lobby;
    if (!lobby) {
      await this.failAction(context, user.id, messages.lobbyExpiredAlert(), false);
      return;
    }
    if (lobby.starterId !== null || !lobby.playerIds.includes(user.id)) {
      await this.failAction(context, user.id, messages.takeoverAlert(), false);
      return;
    }
    lobby.starterId = user.id;
    lobby.error = null;
    lobby.deadlineAt = Date.now() + LOBBY_TTL_MS;
    this.persist();
    await this.editLobbyMessage();
    if (context.callbackId) {
      await this.api.answerCallbackQuery(context.callbackId);
    }
  }

  private async expireLobby(now: number): Promise<void> {
    const lobby = this.state.lobby;
    if (!lobby) {
      return;
    }
    store.setMatchStatus(this.sql, lobby.matchId, "expired", now);
    const messageId = lobby.messageId;
    this.state.lobby = null;
    this.persist();
    if (messageId !== null) {
      this.api.queueEdit(
        this.groupId,
        messageId,
        messages.lobbyText({
          names: new Map(),
          starterId: null,
          playerIds: [],
          expired: true,
        }),
        {},
      );
    }
  }

  private resetDeadlines(state: MatchState, now: number): void {
    if (state.status === "done") {
      this.state.turnDeadlineAt = null;
      this.state.runoutDeadlineAt = null;
      return;
    }
    if (state.runout) {
      this.state.turnDeadlineAt = null;
      this.state.runoutDeadlineAt = now + RUNOUT_STEP_MS;
      return;
    }
    this.state.turnDeadlineAt = now + TURN_SECONDS * 1000;
    this.state.runoutDeadlineAt = null;
  }

  private recordAction(
    userId: number,
    street: Street,
    kind: string,
    to: number | null,
    now: number,
  ): void {
    this.state.actionLog.push({
      t: now,
      user: userId,
      street: STREET_INDEX[street],
      kind,
      to,
    });
  }

  private async completeActionEvents(state: MatchState, now: number): Promise<boolean> {
    this.state.match = state;
    this.resetDeadlines(state, now);
    if (state.status === "done") {
      await this.finishHand(now);
      return true;
    }
    if (state.runout && this.config.effectsEnabled && !this.state.effectsSent) {
      this.state.effectsSent = true;
      try {
        await this.api.sendDice(this.groupId, "🎲");
      } catch (error) {
        console.error(JSON.stringify({ event: "effects_failed", error: safeErrorMessage(error) }));
      }
    }
    this.persist();
    this.editTableMessage(now);
    return false;
  }

  private async betting(userId: number, action: Action, context: ActionContext): Promise<void> {
    const now = Date.now();
    const match = this.state.match;
    if (match?.status !== "active") {
      await this.failAction(context, userId, messages.noMatchAlert());
      return;
    }
    const player = match.players.find((candidate) => candidate.userId === userId);
    if (!player) {
      await this.failAction(context, userId, messages.notInMatchAlert());
      return;
    }
    if (context.source === "callback") {
      if (context.matchId !== match.matchId || context.turnId !== match.turnId) {
        await this.failAction(context, userId, messages.staleMoveAlert(), false);
        return;
      }
    }
    if (match.actorUserId !== userId) {
      const actorId = match.actorUserId as number;
      const actorName = this.namesFor([actorId]).get(actorId) as string;
      await this.failAction(context, userId, messages.notYourTurnAlert(actorName));
      return;
    }
    let result: EngineResult;
    try {
      result = applyAction(match, userId, action);
    } catch (error) {
      if (error instanceof EngineError) {
        if (error.code === "above_cap") {
          await this.failAction(context, userId, messages.raiseCapAlert(maxRaiseTo(match, player)));
          return;
        }
        if (error.code === "illegal_action" && error.message.includes("multiples of 10")) {
          await this.failAction(context, userId, messages.amountMultipleAlert());
          return;
        }
        await this.failAction(context, userId, messages.staleMoveAlert(), false);
        return;
      }
      throw error;
    }
    const after = result.state.players.find(
      (candidate) => candidate.userId === userId,
    ) as PlayerState;
    store.adjustBalance(this.sql, userId, -(after.contribution - player.contribution));
    this.recordAction(userId, match.street, action.kind, action.to ?? null, now);
    if (context.source === "callback" && context.callbackId) {
      await this.api.answerCallbackQuery(context.callbackId);
    }
    await this.completeActionEvents(result.state, now);
  }

  private async applyTimeout(now: number): Promise<void> {
    const match = this.state.match;
    if (match?.status !== "active" || match.actorUserId === null) {
      this.state.turnDeadlineAt = null;
      return;
    }
    const actor = match.players.find(
      (player) => player.userId === match.actorUserId,
    ) as PlayerState;
    const timedOutKind = legalActions(match, actor.userId).some((action) => action.kind === "check")
      ? "check"
      : "fold";
    const result = timeoutAction(match);
    const after = result.state.players.find(
      (candidate) => candidate.userId === actor.userId,
    ) as PlayerState;
    store.adjustBalance(this.sql, actor.userId, -(after.contribution - actor.contribution));
    this.recordAction(actor.userId, match.street, timedOutKind, null, now);
    await this.completeActionEvents(result.state, now);
  }

  private async runoutStep(now: number): Promise<void> {
    const match = this.state.match;
    if (match?.status !== "active" || !match.runout) {
      this.state.runoutDeadlineAt = null;
      return;
    }
    const result = advanceRunout(match);
    await this.completeActionEvents(result.state, now);
  }

  private async finishHand(now: number): Promise<void> {
    const match = this.state.match;
    if (!match) {
      return;
    }
    const names = this.namesFor(match.players.map((player) => player.userId));
    for (const player of match.players) {
      const payout = player.contribution + (match.deltas[player.userId] ?? 0);
      store.adjustBalance(this.sql, player.userId, payout);
      const won = match.winners.includes(player.userId);
      store.addHandStats(this.sql, player.userId, won, payout, match.deltas[player.userId] ?? 0);
      if (player.shown && player.hole) {
        const rank = evaluate7([...player.hole, ...match.board]);
        store.updateBestHand(this.sql, player.userId, rank.name, rank.category);
      }
    }
    store.upsertMatchPlayers(this.sql, match.matchId, store.matchPlayerWrites(match));
    store.finishMatch(this.sql, {
      matchId: match.matchId,
      endedAt: now,
      pot: match.pot,
      board: match.board,
      winners: match.winners,
      log: this.buildLog(match),
    });
    store.pruneMatches(this.sql);
    this.state.turnDeadlineAt = null;
    this.state.runoutDeadlineAt = null;
    this.persist();
    this.editTableMessage(now);
    await this.api.flushEdits();

    const text = messages.resultText(match, names, new Map());
    const message = await this.api.sendMessage(this.groupId, text, {
      reply_markup: resultKeyboard(match.matchId),
    });
    if (message) {
      this.state.resultMessageId = message.message_id;
      this.persist();
    }
    if (this.config.effectsEnabled && match.pot >= 200) {
      try {
        await this.api.sendDice(this.groupId, "🎰");
      } catch (error) {
        console.error(JSON.stringify({ event: "effects_failed", error: safeErrorMessage(error) }));
      }
    }
    await this.api.flushEdits();
  }

  private buildLog(match: MatchState): unknown {
    const holes: Record<string, [Card, Card]> = {};
    for (const player of match.players) {
      if (player.hole) {
        holes[String(player.userId)] = player.hole;
      }
    }
    const streets = [{ name: "preflop", board: [] as Card[] }];
    if (match.board.length >= 3) {
      streets.push({ name: "flop", board: match.board.slice(0, 3) });
    }
    if (match.board.length >= 4) {
      streets.push({ name: "turn", board: match.board.slice(3, 4) });
    }
    if (match.board.length >= 5) {
      streets.push({ name: "river", board: match.board.slice(4, 5) });
    }
    return {
      order: match.order,
      hole: holes,
      streets,
      actions: this.state.actionLog,
      result: { winners: match.winners, pot: match.pot, deltas: match.deltas },
    };
  }

  private editTableMessage(now: number, keyboardOverride?: InlineKeyboardMarkup): void {
    const match = this.state.match;
    if (!match || this.state.tableMessageId === null) {
      return;
    }
    const names = this.namesFor(match.players.map((player) => player.userId));
    const actor = match.actorUserId === null ? null : playerById(match, match.actorUserId);
    const secondsLeft =
      actor !== null && this.state.turnDeadlineAt !== null
        ? Math.max(0, Math.ceil((this.state.turnDeadlineAt - now) / 1000))
        : null;
    const text = messages.tableText({ match, names, secondsLeft });
    const keyboard =
      keyboardOverride ??
      tableKeyboard({
        matchId: match.matchId,
        turnId: match.turnId,
        state: match,
        actor,
      });
    this.api.queueEdit(this.groupId, this.state.tableMessageId, text, {
      reply_markup: keyboard,
    });
  }

  private async showHand(userId: number, callbackId?: string): Promise<void> {
    const match = this.state.match;
    if (match?.status !== "done") {
      if (callbackId) {
        await this.api.answerCallbackQuery(callbackId, { text: messages.showNoneAlert() });
      } else {
        await this.privateAlert(userId, messages.showNoneAlert());
      }
      return;
    }
    let result: EngineResult;
    try {
      result = revealHand(match, userId);
    } catch (error) {
      const text =
        error instanceof EngineError && error.code === "already_shown"
          ? messages.showNoneAlert()
          : messages.notInMatchAlert();
      if (callbackId) {
        await this.api.answerCallbackQuery(callbackId, { text });
      } else {
        await this.privateAlert(userId, text);
      }
      return;
    }
    this.state.match = result.state;
    this.persist();
    if (callbackId) {
      await this.api.answerCallbackQuery(callbackId);
    }
    const names = this.namesFor(match.players.map((player) => player.userId));
    const shown = new Map<number, [Card, Card]>();
    for (const player of result.state.players) {
      if (player.shown && player.hole && !result.state.winners.includes(player.userId)) {
        shown.set(player.userId, player.hole);
      }
    }
    if (this.state.resultMessageId !== null) {
      const text = messages.resultText(result.state, names, shown);
      this.api.queueEdit(this.groupId, this.state.resultMessageId, text, {
        reply_markup: resultKeyboard(match.matchId),
      });
    }
    await this.api.flushEdits();
  }

  private async handleDaily(intent: CommandIntent): Promise<void> {
    const now = Date.now();
    const player = store.getPlayer(this.sql, intent.userId);
    if (!player) {
      return;
    }
    if (player.last_daily_at !== null && now - player.last_daily_at < DAILY_COOLDOWN_MS) {
      await this.api.sendMessage(
        intent.chatId,
        messages.dailyTooEarlyText(DAILY_COOLDOWN_MS - (now - player.last_daily_at)),
      );
      return;
    }
    store.adjustBalance(this.sql, player.user_id, DAILY_AMOUNT);
    store.setDaily(this.sql, player.user_id, now);
    const updated = store.getPlayer(this.sql, player.user_id);
    await this.api.sendMessage(intent.chatId, messages.dailyClaimedText(updated?.balance ?? 0));
    try {
      await this.api.sendMessage(this.groupId, messages.dailyTeaserText(player.first_name));
    } catch (error) {
      console.error(
        JSON.stringify({ event: "daily_teaser_failed", error: safeErrorMessage(error) }),
      );
    }
  }

  private async sendBalance(chatId: number, userId: number): Promise<void> {
    const player = store.getPlayer(this.sql, userId);
    if (!player) {
      return;
    }
    await this.api.sendMessage(
      chatId,
      messages.balanceText(
        {
          balance: player.balance,
          lastDailyAt: player.last_daily_at,
          handsPlayed: player.hands_played,
          handsWon: player.hands_won,
          chipsWon: player.chips_won,
          chipsLost: player.chips_lost,
          now: Date.now(),
        },
        DAILY_COOLDOWN_MS,
      ),
    );
  }

  private async sendStats(chatId: number, userId: number): Promise<void> {
    const player = store.getPlayer(this.sql, userId);
    if (!player) {
      return;
    }
    await this.api.sendMessage(
      chatId,
      messages.statsText(
        {
          balance: player.balance,
          lastDailyAt: player.last_daily_at,
          handsPlayed: player.hands_played,
          handsWon: player.hands_won,
          chipsWon: player.chips_won,
          chipsLost: player.chips_lost,
          biggestPot: player.biggest_pot,
          bestHand: player.best_hand,
          now: Date.now(),
        },
        store.getMeta(this.sql, "group_title"),
      ),
    );
  }

  private async sendHistory(chatId: number, userId: number, args: string): Promise<void> {
    const parsed = Number.parseInt(args.trim(), 10);
    const limit = Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, 1), 20) : 5;
    const rows = store.playerHistory(this.sql, userId, limit).map((row) => ({
      handNo: row.hand_no,
      won: (JSON.parse(row.winner_ids ?? "[]") as number[]).includes(userId),
      delta: row.delta,
      hole: row.hole === null ? null : (JSON.parse(row.hole) as Card[]),
      board: row.board === null ? [] : (JSON.parse(row.board) as Card[]),
    }));
    await this.api.sendMessage(chatId, messages.historyText(rows));
  }

  private async sendLeaderboard(chatId: number): Promise<void> {
    const rows = store
      .leaderboard(this.sql, 5)
      .filter((player) => player.balance > 0)
      .map((player) => ({ firstName: player.first_name, balance: player.balance }));
    await this.api.sendMessage(
      chatId,
      messages.leaderboardText(rows, store.getMeta(this.sql, "group_title")),
    );
  }

  private async sendVersion(intent: CommandIntent): Promise<void> {
    if (intent.userId !== this.config.ownerUserId) {
      await this.privateAlert(intent.userId, messages.ownerOnlyText());
      return;
    }
    const info = await this.api.call<{ url?: string; pending_update_count?: number }>(
      "getWebhookInfo",
      {},
    );
    await this.api.sendMessage(
      intent.chatId,
      messages.versionText("0.1.0", info.url ?? null, info.pending_update_count ?? 0),
    );
  }

  private async resetGroup(intent: CommandIntent): Promise<void> {
    if (intent.userId !== this.config.ownerUserId) {
      await this.privateAlert(intent.userId, messages.ownerOnlyText());
      return;
    }
    const parts = intent.args.trim().split(/\s+/);
    if (parts[0] === "confirm") {
      const target = Number(parts[1]);
      const pending = store.getMeta(this.sql, "reset_pending");
      if (pending === null || Number(pending) !== target) {
        await this.api.sendMessage(
          intent.chatId,
          "Nothing pending. Run /resetgroup <chat_id> first.",
        );
        return;
      }
      store.wipeGroup(this.sql);
      this.state = emptyState();
      this.persist();
      await this.api.sendMessage(intent.chatId, messages.resetGroupDoneText(target));
      return;
    }
    const target = Number(parts[0]);
    if (!Number.isSafeInteger(target) || target !== this.groupId) {
      await this.api.sendMessage(
        intent.chatId,
        `Usage: /resetgroup ${this.groupId} (then confirm)`,
      );
      return;
    }
    store.setMeta(this.sql, "reset_pending", String(target));
    await this.api.sendMessage(intent.chatId, messages.resetGroupConfirmText(target));
  }

  private async dmCards(userId: number): Promise<void> {
    const match = this.state.match;
    const player = match?.players.find((candidate) => candidate.userId === userId);
    if (!match || !player?.hole) {
      await this.privateAlert(userId, messages.cardsNoneAlert());
      return;
    }
    await this.api.sendMessage(userId, messages.dmCardsText(match.handNo, player.hole));
  }
}
