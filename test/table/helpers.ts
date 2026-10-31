import { type Database, openDatabase } from "../../src/db";
import type { AppConfig } from "../../src/env";
import * as store from "../../src/game/store";
import { Table } from "../../src/game/table";
import { setTelegramTransport } from "../../src/telegram/api";
import { updateSchema } from "../../src/telegram/bot";

export const GROUP_ID = -1009999999999;
export const OWNER = 424242;

const CONFIG: AppConfig = {
  botToken: "123456:TEST_TOKEN",
  botUsername: "dailypoker_test_bot",
  allowedChatIds: [GROUP_ID],
  ownerUserId: OWNER,
};

let db: Database;
let table: Table;

function createTable(): void {
  db = openDatabase(":memory:");
  table = new Table(CONFIG, db);
}

createTable();

export interface TelegramCall {
  method: string;
  payload: Record<string, unknown>;
}

export function installMockTelegram(): TelegramCall[] {
  const calls: TelegramCall[] = [];
  let nextMessageId = 100;
  const fetcher = (async (input: Request | string | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = url.split("/").pop() ?? "";
    const payload = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ method, payload });
    let result: unknown = true;
    if (method === "sendMessage") {
      result = { message_id: nextMessageId++, chat: { id: payload.chat_id } };
    }
    if (method === "getWebhookInfo") {
      result = { url: "", pending_update_count: 0 };
    }
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  setTelegramTransport(fetcher);
  return calls;
}

export async function postUpdate(update: unknown): Promise<Response> {
  const parsed = updateSchema.safeParse(update);
  if (!parsed.success) {
    return new Response("ok");
  }
  try {
    await table.handleUpdate(parsed.data);
  } catch {
    return new Response("error", { status: 500 });
  }
  return new Response("ok");
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
  const rows = db
    .exec("SELECT value FROM meta WHERE key = 'table_state'")
    .toArray<{ value: string }>();
  const raw = rows[0]?.value;
  if (raw === undefined) {
    return { lobby: null, match: null };
  }
  const parsed = JSON.parse(raw) as TableSnapshot & { match: TableSnapshot["match"] };
  return { lobby: parsed.lobby ?? null, match: parsed.match ?? null };
}

export async function seedPlayer(
  userId: number,
  firstName: string,
  balance: number,
  dmStarted: boolean,
): Promise<void> {
  store.ensurePlayer(db, { id: userId, firstName, username: null }, Date.now());
  store.adjustBalance(db, userId, balance);
  if (dmStarted) {
    store.setDmStarted(db, userId);
  }
}

export async function getBalance(userId: number): Promise<number> {
  return store.getPlayer(db, userId)?.balance ?? 0;
}

export async function setTurnDeadlineInPast(): Promise<void> {
  const internal = table as unknown as {
    state: { turnDeadlineAt: number | null };
    persist(): void;
  };
  internal.state.turnDeadlineAt = Date.now() - 1000;
  internal.persist();
}

export async function setRunoutDeadlineInPast(): Promise<void> {
  const internal = table as unknown as {
    state: { runoutDeadlineAt: number | null };
    persist(): void;
  };
  internal.state.runoutDeadlineAt = Date.now() - 1000;
  internal.persist();
}

export async function cleanStorage(): Promise<void> {
  db.close();
  createTable();
}

export function restartTable(): void {
  table = new Table(CONFIG, db);
}

export async function runAlarm(): Promise<boolean> {
  await table.tick();
  return true;
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

export async function getPlayerRow(userId: number): Promise<Record<string, unknown> | null> {
  const rows = db
    .exec("SELECT * FROM players WHERE user_id = ?", userId)
    .toArray<Record<string, unknown>>();
  return rows[0] ?? null;
}

export async function setLastDailyAt(userId: number, at: number): Promise<void> {
  store.setDaily(db, userId, at);
}

export async function setBalance(userId: number, balance: number): Promise<void> {
  db.exec("UPDATE players SET balance = ? WHERE user_id = ?", balance, userId);
}

export async function countRows(table: "players" | "matches" | "match_players"): Promise<number> {
  const row = db.exec(`SELECT COUNT(*) AS count FROM ${table}`).one<{ count: number }>();
  return row.count;
}

export async function insertFakeMatches(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    db.exec(
      `INSERT INTO matches (hand_no, status, starter_id, created_at, started_at, ended_at)
       VALUES (?, 'done', 1, 1, 1, 1)`,
      i + 1,
    );
  }
}

export async function runPruneMatches(): Promise<void> {
  store.pruneMatches(db);
}

export async function insertScriptedCorpus(
  hands: number,
  playerOne: number,
  playerTwo: number,
): Promise<void> {
  for (let i = 1; i <= hands; i++) {
    const winner = i % 2 === 1 ? playerOne : playerTwo;
    const delta = winner === playerOne ? 10 : -10;
    db.exec(
      `INSERT INTO matches (hand_no, status, starter_id, created_at, started_at, ended_at, pot, board, winner_ids)
       VALUES (?, 'done', ?, ?, ?, ?, 20, '["As","Kd","7c"]', ?)`,
      i,
      playerOne,
      i,
      i,
      i,
      JSON.stringify([winner]),
    );
    const matchId = db.exec("SELECT last_insert_rowid() AS id").one<{ id: number }>().id;
    db.exec(
      `INSERT INTO match_players (match_id, user_id, seat_order, contribution, folded, all_in, shown, hole, delta)
       VALUES (?, ?, 0, 10, 0, 0, 0, '["Ah","Kh"]', ?)`,
      matchId,
      playerOne,
      delta,
    );
    db.exec(
      `INSERT INTO match_players (match_id, user_id, seat_order, contribution, folded, all_in, shown, hole, delta)
       VALUES (?, ?, 1, 10, 0, 0, 0, '["2c","3d"]', ?)`,
      matchId,
      playerTwo,
      -delta,
    );
    store.adjustBalance(db, playerOne, delta + 10);
    store.adjustBalance(db, playerTwo, -delta + 10);
    store.addHandStats(db, playerOne, winner === playerOne, winner === playerOne ? 20 : 0, delta);
    store.addHandStats(db, playerTwo, winner === playerTwo, winner === playerTwo ? 20 : 0, -delta);
  }
}
