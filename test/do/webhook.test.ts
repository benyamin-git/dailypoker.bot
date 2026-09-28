import { reset, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetTelegramTransport } from "../../src/telegram/api";
import {
  cleanStorage,
  GROUP_ID,
  installMockTelegram,
  messageUpdate,
  postUpdate,
  type TelegramCall,
} from "./helpers";

const WEBHOOK_PATH = "test-webhook-path";
const SECRET = "test-webhook-secret-0000";
const ADMIN_KEY = "test-admin-key-00000000";
const UNKNOWN_CHAT_ID = -1007777777777;

function installLocalMock(): TelegramCall[] {
  return installMockTelegram();
}

function sentTo(calls: TelegramCall[], chatId: number): TelegramCall[] {
  return calls.filter((call) => call.method === "sendMessage" && call.payload.chat_id === chatId);
}

beforeEach(async () => {
  await cleanStorage();
  await reset();
});

afterEach(() => {
  resetTelegramTransport();
});

describe("webhook routing", () => {
  it("rejects POSTs without the secret header", async () => {
    const response = await postUpdate(messageUpdate(1, GROUP_ID, 42, "/ping"), { secret: null });
    expect(response.status).toBe(403);
  });

  it("rejects POSTs with a wrong secret", async () => {
    const response = await postUpdate(messageUpdate(1, GROUP_ID, 42, "/ping"), {
      secret: "wrong-secret-value",
    });
    expect(response.status).toBe(403);
  });

  it("returns 404 for the wrong path", async () => {
    const response = await postUpdate(messageUpdate(1, GROUP_ID, 42, "/ping"), {
      path: "/tg/not-the-path",
    });
    expect(response.status).toBe(404);
  });

  it("rejects non-POST requests on the webhook path", async () => {
    const response = await postUpdate(messageUpdate(1, GROUP_ID, 42, "/ping"), { method: "GET" });
    expect(response.status).toBe(405);
  });
});

describe("ping", () => {
  it("replies pong in the allowlisted group", async () => {
    const calls = installLocalMock();
    const response = await postUpdate(messageUpdate(1, GROUP_ID, 42, "/ping"));
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("sendMessage");
    expect(calls[0]?.payload.chat_id).toBe(GROUP_ID);
    expect(calls[0]?.payload.text).toBe("🏓 pong (dev)");
  });
});

describe("allowlist", () => {
  it("sends one polite reply to an unknown group, then silence", async () => {
    const calls = installLocalMock();
    await postUpdate(messageUpdate(1, UNKNOWN_CHAT_ID, 42, "/ping"));
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.payload.text)).toContain("private");
    await postUpdate(messageUpdate(2, UNKNOWN_CHAT_ID, 42, "/ping"));
    expect(calls).toHaveLength(1);
  });
});

describe("update dedupe", () => {
  it("processes a duplicate update_id exactly once", async () => {
    const calls = installLocalMock();
    const update = messageUpdate(1, GROUP_ID, 42, "/ping");
    await postUpdate(update);
    await postUpdate(update);
    expect(calls).toHaveLength(1);
  });
});

describe("admin routes", () => {
  it("rejects admin calls without the admin key", async () => {
    const response = await SELF.fetch(`https://example.com/tg/${WEBHOOK_PATH}/admin/webhook-info`);
    expect(response.status).toBe(403);
  });

  it("registers the webhook with the secret token and allowed updates", async () => {
    const calls = installLocalMock();
    const response = await SELF.fetch(
      `https://example.com/tg/${WEBHOOK_PATH}/admin/register-webhook`,
      { method: "POST", headers: { "x-admin-key": ADMIN_KEY } },
    );
    expect(response.status).toBe(200);
    const setWebhook = calls.find((call) => call.method === "setWebhook");
    expect(setWebhook?.payload.url).toBe(`https://example.com/tg/${WEBHOOK_PATH}`);
    expect(setWebhook?.payload.secret_token).toBe(SECRET);
    expect(setWebhook?.payload.allowed_updates).toEqual([
      "message",
      "callback_query",
      "my_chat_member",
    ]);
    expect(setWebhook?.payload.drop_pending_updates).toBe(true);
  });

  it("configures group and private command scopes", async () => {
    const calls = installLocalMock();
    const response = await SELF.fetch(`https://example.com/tg/${WEBHOOK_PATH}/admin/set-commands`, {
      method: "POST",
      headers: { "x-admin-key": ADMIN_KEY },
    });
    expect(response.status).toBe(200);
    const commands = calls.filter((call) => call.method === "setMyCommands");
    expect(commands).toHaveLength(2);
    const scopes = commands.map((call) => (call.payload.scope as { type: string }).type).sort();
    expect(scopes).toEqual(["all_group_chats", "all_private_chats"]);
  });

  it("proxies webhook info for debugging", async () => {
    installLocalMock();
    const response = await SELF.fetch(`https://example.com/tg/${WEBHOOK_PATH}/admin/webhook-info`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ url: "https://example.com" });
  });
});

describe("unknown groups", () => {
  it("does not invoke telegram for non-allowlisted chats beyond one reply", async () => {
    const calls = installLocalMock();
    await postUpdate(messageUpdate(1, UNKNOWN_CHAT_ID, 42, "/newmatch"));
    expect(sentTo(calls, UNKNOWN_CHAT_ID)).toHaveLength(1);
  });
});
