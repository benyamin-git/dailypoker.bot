import {
  env,
  evictAllDurableObjects,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import * as store from "../../src/game/store";
import type { TableDO } from "../../src/game/table-do";
import { setTelegramTransport } from "../../src/telegram/api";

export const WEBHOOK_PATH = "test-webhook-path";
export const SECRET = "test-webhook-secret-0000";
export const GROUP_ID = -1009999999999;

export interface TelegramCall {
  method: string;
  payload: Record<string, unknown>;
}

export function installMockTelegram(): TelegramCall[] {
  const calls: TelegramCall[] = [];
  let nextMessageId = 100;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = url.split("/").pop() ?? "";
    const payload = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ method, payload });
    let result: unknown = true;
    if (method === "sendMessage" || method === "sendDice") {
      result = { message_id: nextMessageId++, chat: { id: payload.chat_id } };
    }
    if (method === "getWebhookInfo") {
      result = { url: "https://example.com", pending_update_count: 0 };
    }
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  setTelegramTransport(fetcher);
  return calls;
}

export interface PostOptions {
  path?: string;
  secret?: string | null;
  method?: string;
}

export async function postUpdate(update: unknown, options: PostOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.secret !== null) {
    headers["X-Telegram-Bot-Api-Secret-Token"] = options.secret ?? SECRET;
  }
  const method = options.method ?? "POST";
  return SELF.fetch(`https://example.com${options.path ?? `/tg/${WEBHOOK_PATH}`}`, {
    method,
    headers,
    ...(method === "POST" ? { body: JSON.stringify(update) } : {}),
  });
}

export function messageUpdate(
  updateId: number,
  chatId: number,
  userId: number,
  text: string,
  chatType: "private" | "supergroup" = "supergroup",
  firstName = "Player",
) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: userId, first_name: firstName, is_bot: false },
      chat: {
        id: chatId,
        type: chatType,
        title: chatType === "private" ? undefined : "Test Group",
      },
      text,
    },
  };
}

export function callbackUpdate(
  updateId: number,
  chatId: number,
  userId: number,
  data: string,
  messageId = 1,
  chatType: "private" | "supergroup" = "supergroup",
  firstName = "Player",
) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      from: { id: userId, first_name: firstName, is_bot: false },
      message: {
        message_id: messageId,
        chat: {
          id: chatId,
          type: chatType,
          title: chatType === "private" ? undefined : "Test Group",
        },
      },
      data,
    },
  };
}

function groupStub() {
  return env.TABLE.get(env.TABLE.idFromName(String(GROUP_ID)));
}

export interface TableSnapshot {
  lobby: {
    matchId: number;
    starterId: number | null;
    playerIds: number[];
    messageId: number | null;
  } | null;
  match: {
    matchId: number;
    status: string;
    actorUserId: number | null;
    turnId: number;
    runout: boolean;
    pot: number;
    handNo: number;
    winners: number[];
  } | null;
}

export async function getTableState(): Promise<TableSnapshot> {
  const stub = groupStub();
  return runInDurableObject(stub, async (_instance: TableDO, state) => {
    const rows = state.storage.sql
      .exec("SELECT value FROM meta WHERE key = 'table_state'")
      .toArray() as { value: string }[];
    const raw = rows[0]?.value;
    if (raw === undefined) {
      return { lobby: null, match: null };
    }
    const parsed = JSON.parse(raw) as TableSnapshot;
    return { lobby: parsed.lobby ?? null, match: parsed.match ?? null };
  });
}

export async function seedPlayer(
  userId: number,
  firstName: string,
  balance: number,
  dmStarted: boolean,
): Promise<void> {
  const stub = groupStub();
  await runInDurableObject(stub, async (_instance: TableDO, state) => {
    const sql = state.storage.sql;
    store.ensurePlayer(sql, { id: userId, firstName, username: null }, Date.now());
    store.adjustBalance(sql, userId, balance);
    if (dmStarted) {
      store.setDmStarted(sql, userId);
    }
  });
}

export async function getBalance(userId: number): Promise<number> {
  const stub = groupStub();
  return runInDurableObject(stub, async (_instance: TableDO, state) => {
    const player = store.getPlayer(state.storage.sql, userId);
    return player?.balance ?? 0;
  });
}

export async function setTurnDeadlineInPast(): Promise<void> {
  const stub = groupStub();
  await runInDurableObject(stub, async (instance: TableDO) => {
    const internal = instance as unknown as {
      state: { turnDeadlineAt: number | null };
      persist(): void;
    };
    internal.state.turnDeadlineAt = Date.now() - 1000;
    internal.persist();
  });
}

export async function setRunoutDeadlineInPast(): Promise<void> {
  const stub = groupStub();
  await runInDurableObject(stub, async (instance: TableDO) => {
    const internal = instance as unknown as {
      state: { runoutDeadlineAt: number | null };
      persist(): void;
    };
    internal.state.runoutDeadlineAt = Date.now() - 1000;
    internal.persist();
  });
}

export async function cleanStorage(): Promise<void> {
  await reset();
  await evictAllDurableObjects();
}

export async function runAlarm(): Promise<boolean> {
  return runDurableObjectAlarm(groupStub());
}

export function sentMessages(calls: TelegramCall[], chatId?: number): TelegramCall[] {
  return calls.filter(
    (call) =>
      call.method === "sendMessage" && (chatId === undefined || call.payload.chat_id === chatId),
  );
}

export function edits(calls: TelegramCall[]): TelegramCall[] {
  return calls.filter((call) => call.method === "editMessageText");
}

export function lastGroupText(calls: TelegramCall[], chatId: number = GROUP_ID): string {
  const list = sentMessages(calls, chatId);
  const last = list[list.length - 1];
  return last === undefined ? "" : String(last.payload.text);
}

export function lastEditText(calls: TelegramCall[]): string {
  const list = edits(calls);
  const last = list[list.length - 1];
  return last === undefined ? "" : String(last.payload.text);
}

export { reset };

export async function getPlayerRow(userId: number): Promise<Record<string, unknown> | null> {
  const stub = groupStub();
  return runInDurableObject(stub, async (_instance: TableDO, state) => {
    const rows = state.storage.sql
      .exec("SELECT * FROM players WHERE user_id = ?", userId)
      .toArray() as unknown as Record<string, unknown>[];
    return rows[0] ?? null;
  });
}

export async function setLastDailyAt(userId: number, at: number): Promise<void> {
  const stub = groupStub();
  await runInDurableObject(stub, async (_instance: TableDO, state) => {
    store.setDaily(state.storage.sql, userId, at);
  });
}

export async function setBalance(userId: number, balance: number): Promise<void> {
  const stub = groupStub();
  await runInDurableObject(stub, async (_instance: TableDO, state) => {
    state.storage.sql.exec("UPDATE players SET balance = ? WHERE user_id = ?", balance, userId);
  });
}

export async function countRows(table: "players" | "matches" | "match_players"): Promise<number> {
  const stub = groupStub();
  return runInDurableObject(stub, async (_instance: TableDO, state) => {
    const row = state.storage.sql.exec(`SELECT COUNT(*) AS count FROM ${table}`).one() as {
      count: number;
    };
    return row.count;
  });
}

export async function insertFakeMatches(count: number): Promise<void> {
  const stub = groupStub();
  await runInDurableObject(stub, async (_instance: TableDO, state) => {
    const sql = state.storage.sql;
    for (let i = 0; i < count; i++) {
      sql.exec(
        `INSERT INTO matches (hand_no, status, starter_id, created_at, started_at, ended_at)
         VALUES (?, 'done', 1, 1, 1, 1)`,
        i + 1,
      );
    }
  });
}

export async function runPruneMatches(): Promise<void> {
  const stub = groupStub();
  await runInDurableObject(stub, async (_instance: TableDO, state) => {
    store.pruneMatches(state.storage.sql);
  });
}

export async function insertScriptedCorpus(
  hands: number,
  playerOne: number,
  playerTwo: number,
): Promise<void> {
  const stub = groupStub();
  await runInDurableObject(stub, async (_instance: TableDO, state) => {
    const sql = state.storage.sql;
    for (let i = 1; i <= hands; i++) {
      const winner = i % 2 === 1 ? playerOne : playerTwo;
      const delta = winner === playerOne ? 10 : -10;
      sql.exec(
        `INSERT INTO matches (hand_no, status, starter_id, created_at, started_at, ended_at, pot, board, winner_ids)
         VALUES (?, 'done', ?, ?, ?, ?, 20, '["As","Kd","7c"]', ?)`,
        i,
        playerOne,
        i,
        i,
        i,
        JSON.stringify([winner]),
      );
      const matchId = (sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number }).id;
      sql.exec(
        `INSERT INTO match_players (match_id, user_id, seat_order, contribution, folded, all_in, shown, hole, delta)
         VALUES (?, ?, 0, 10, 0, 0, 0, '["Ah","Kh"]', ?)`,
        matchId,
        playerOne,
        delta,
      );
      sql.exec(
        `INSERT INTO match_players (match_id, user_id, seat_order, contribution, folded, all_in, shown, hole, delta)
         VALUES (?, ?, 1, 10, 0, 0, 0, '["2c","3d"]', ?)`,
        matchId,
        playerTwo,
        -delta,
      );
      store.adjustBalance(sql, playerOne, delta + 10);
      store.adjustBalance(sql, playerTwo, -delta + 10);
      store.addHandStats(
        sql,
        playerOne,
        winner === playerOne,
        winner === playerOne ? 20 : 0,
        delta,
      );
      store.addHandStats(
        sql,
        playerTwo,
        winner === playerTwo,
        winner === playerTwo ? 20 : 0,
        -delta,
      );
    }
  });
}
