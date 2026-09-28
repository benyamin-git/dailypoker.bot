import { reset, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetTelegramTransport, setTelegramTransport } from "../../src/telegram/api";

const WEBHOOK_PATH = "test-webhook-path";
const SECRET = "test-webhook-secret-0000";
const ALLOWED_CHAT_ID = -1009999999999;
const UNKNOWN_CHAT_ID = -1007777777777;

interface TelegramCall {
  method: string;
  payload: Record<string, unknown>;
}

function installMockTelegram(): TelegramCall[] {
  const calls: TelegramCall[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = url.split("/").pop() ?? "";
    const payload = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ method, payload });
    const result =
      method === "sendMessage" ? { message_id: calls.length, chat: { id: payload.chat_id } } : true;
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  setTelegramTransport(fetcher);
  return calls;
}

function messageUpdate(updateId: number, chatId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: 42, first_name: "Ali", username: "ali", is_bot: false },
      chat: { id: chatId, type: "supergroup", title: "Test Group" },
      text,
    },
  };
}

interface PostOptions {
  path?: string;
  secret?: string | null;
  method?: string;
}

async function postUpdate(update: unknown, options: PostOptions = {}): Promise<Response> {
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

beforeEach(async () => {
  await reset();
});

afterEach(() => {
  resetTelegramTransport();
});

describe("webhook routing", () => {
  it("rejects POSTs without the secret header", async () => {
    const response = await postUpdate(messageUpdate(1, ALLOWED_CHAT_ID, "/ping"), {
      secret: null,
    });
    expect(response.status).toBe(403);
  });

  it("rejects POSTs with a wrong secret", async () => {
    const response = await postUpdate(messageUpdate(1, ALLOWED_CHAT_ID, "/ping"), {
      secret: "wrong-secret-value",
    });
    expect(response.status).toBe(403);
  });

  it("returns 404 for the wrong path", async () => {
    const response = await postUpdate(messageUpdate(1, ALLOWED_CHAT_ID, "/ping"), {
      path: "/tg/not-the-path",
    });
    expect(response.status).toBe(404);
  });

  it("rejects non-POST requests on the webhook path", async () => {
    const response = await postUpdate(messageUpdate(1, ALLOWED_CHAT_ID, "/ping"), {
      method: "GET",
    });
    expect(response.status).toBe(405);
  });
});

describe("ping", () => {
  it("replies pong in the allowlisted group", async () => {
    const calls = installMockTelegram();
    const response = await postUpdate(messageUpdate(1, ALLOWED_CHAT_ID, "/ping"));
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("sendMessage");
    expect(calls[0]?.payload.chat_id).toBe(ALLOWED_CHAT_ID);
    expect(calls[0]?.payload.text).toBe("🏓 pong (dev)");
  });
});

describe("allowlist", () => {
  it("sends one polite reply to an unknown group, then silence", async () => {
    const calls = installMockTelegram();
    await postUpdate(messageUpdate(1, UNKNOWN_CHAT_ID, "/ping"));
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.payload.text)).toContain("private");
    await postUpdate(messageUpdate(2, UNKNOWN_CHAT_ID, "/ping"));
    expect(calls).toHaveLength(1);
  });
});

describe("update dedupe", () => {
  it("processes a duplicate update_id exactly once", async () => {
    const calls = installMockTelegram();
    const update = messageUpdate(1, ALLOWED_CHAT_ID, "/ping");
    await postUpdate(update);
    await postUpdate(update);
    expect(calls).toHaveLength(1);
  });
});
