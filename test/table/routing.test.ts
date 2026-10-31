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

const UNKNOWN_CHAT_ID = -1007777777777;

function sentTo(calls: TelegramCall[], chatId: number): TelegramCall[] {
  return calls.filter((call) => call.method === "sendMessage" && call.payload.chat_id === chatId);
}

beforeEach(async () => {
  await cleanStorage();
});

afterEach(() => {
  resetTelegramTransport();
});

describe("update handling", () => {
  it("replies pong in the allowlisted group", async () => {
    const calls = installMockTelegram();
    const response = await postUpdate(messageUpdate(1, GROUP_ID, 42, "/ping"));
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("sendMessage");
    expect(calls[0]?.payload.chat_id).toBe(GROUP_ID);
    expect(calls[0]?.payload.text).toBe("pong (dev)");
  });
});

describe("allowlist", () => {
  it("sends one polite reply to an unknown group, then silence", async () => {
    const calls = installMockTelegram();
    await postUpdate(messageUpdate(1, UNKNOWN_CHAT_ID, 42, "/ping"));
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.payload.text)).toContain("private");
    await postUpdate(messageUpdate(2, UNKNOWN_CHAT_ID, 42, "/ping"));
    expect(calls).toHaveLength(1);
  });
});

describe("update dedupe", () => {
  it("processes a duplicate update_id exactly once", async () => {
    const calls = installMockTelegram();
    const update = messageUpdate(1, GROUP_ID, 42, "/ping");
    await postUpdate(update);
    await postUpdate(update);
    expect(calls).toHaveLength(1);
  });
});

describe("unknown groups", () => {
  it("does not invoke telegram for non-allowlisted chats beyond one reply", async () => {
    const calls = installMockTelegram();
    await postUpdate(messageUpdate(1, UNKNOWN_CHAT_ID, 42, "/newmatch"));
    expect(sentTo(calls, UNKNOWN_CHAT_ID)).toHaveLength(1);
  });
});
