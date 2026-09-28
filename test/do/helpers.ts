import {
  abortAllDurableObjects,
  env,
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
  await abortAllDurableObjects();
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

export function lastEditText(calls: TelegramCall[]): string {
  const list = edits(calls);
  const last = list[list.length - 1];
  return last === undefined ? "" : String(last.payload.text);
}

export { reset };
