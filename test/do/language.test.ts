import { evictAllDurableObjects } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetTelegramTransport, setDefaultMinEditInterval } from "../../src/telegram/api";
import {
  callbackUpdate,
  cleanStorage,
  GROUP_ID,
  getTableState,
  installMockTelegram,
  lastEditText,
  lastGroupText,
  messageUpdate,
  postUpdate,
  seedPlayer,
  sentMessages,
  type TelegramCall,
} from "./helpers";

const P1 = 1111;
const P2 = 2222;

let updateCounter = 5000;

function nextUpdateId(): number {
  updateCounter += 1;
  return updateCounter;
}

function groupMessage(userId: number, text: string, firstName = "Ali"): Promise<Response> {
  return postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, userId, text, "supergroup", firstName));
}

function dm(userId: number, text: string, firstName = "Ali"): Promise<Response> {
  return postUpdate(messageUpdate(nextUpdateId(), userId, userId, text, "private", firstName));
}

function texts(calls: TelegramCall[], chatId?: number): string[] {
  return sentMessages(calls, chatId).map((call) => String(call.payload.text ?? ""));
}

function answerTexts(calls: TelegramCall[]): string[] {
  return calls
    .filter((call) => call.method === "answerCallbackQuery")
    .map((call) => String(call.payload.text ?? ""));
}

beforeEach(async () => {
  await cleanStorage();
  setDefaultMinEditInterval(0);
  installMockTelegram();
});

afterEach(() => {
  resetTelegramTransport();
});

describe("language mode", () => {
  it("starts in English and toggles with /fa and /en", async () => {
    await seedPlayer(P1, "Ali", 200, true);
    let calls = installMockTelegram();
    await groupMessage(P1, "/ping");
    expect(texts(calls, GROUP_ID)[0]).toBe("🏓 pong (dev)");

    calls = installMockTelegram();
    await groupMessage(P1, "/fa");
    expect(texts(calls, GROUP_ID)[0]).toContain("زبان ربات به فارسی تغییر کرد");

    calls = installMockTelegram();
    await groupMessage(P1, "/help");
    expect(texts(calls, GROUP_ID)[0]).toContain("دستورات گروه");

    calls = installMockTelegram();
    await groupMessage(P1, "/en");
    expect(texts(calls, GROUP_ID)[0]).toContain("Language set to English");

    calls = installMockTelegram();
    await groupMessage(P1, "/help");
    expect(texts(calls, GROUP_ID)[0]).toContain("Group commands");
  });

  it("localizes the lobby, activity messages and DMs during a hand", async () => {
    await seedPlayer(P1, "Ali", 200, true);
    await seedPlayer(P2, "Reza", 200, true);
    await groupMessage(P1, "/fa");

    let calls = installMockTelegram();
    await groupMessage(P1, "/newmatch");
    expect(texts(calls, GROUP_ID)[0]).toContain("اتاق انتظار");

    await groupMessage(P2, "/join", "Reza");
    expect(lastEditText(calls)).toContain("عضوها (2)");

    calls = installMockTelegram();
    await groupMessage(P1, "/deal");
    const deal = lastGroupText(calls);
    expect(deal).toContain("اول بازی میکند");
    expect(deal).toContain("نوبت:");
    expect(deal).toContain("در پات");
    const dms = sentMessages(calls).filter((call) => call.payload.chat_id !== GROUP_ID);
    expect(dms).toHaveLength(2);
    for (const message of dms) {
      expect(String(message.payload.text)).toContain("دست شما");
    }

    const state = await getTableState();
    const actor = state.match?.actorUserId as number;
    calls = installMockTelegram();
    await postUpdate(
      callbackUpdate(
        nextUpdateId(),
        GROUP_ID,
        actor,
        `m:${state.match?.matchId}:${state.match?.turnId}:fold`,
        1,
      ),
    );
    expect(texts(calls, GROUP_ID).some((text) => text.includes("فولد کرد"))).toBe(true);
  });

  it("localizes callback buttons and alerts", async () => {
    await seedPlayer(P1, "Ali", 200, true);
    await seedPlayer(P2, "Reza", 200, true);
    await groupMessage(P1, "/fa");
    await groupMessage(P1, "/newmatch");
    await groupMessage(P2, "/join", "Reza");

    const calls = installMockTelegram();
    await groupMessage(P1, "/deal");
    const dealCall = sentMessages(calls, GROUP_ID).at(-1);
    const markup = JSON.stringify(dealCall?.payload.reply_markup);
    expect(markup).toContain("فولد");
    expect(markup).toContain("چک");
    expect(markup).toContain("ریز");

    const staleCalls = installMockTelegram();
    await postUpdate(callbackUpdate(nextUpdateId(), GROUP_ID, P1, "m:1:999:check", 1));
    expect(answerTexts(staleCalls)).toContain("این حرکت دیگر در دسترس نیست");
  });

  it("keeps the chosen language across durable object eviction", async () => {
    await seedPlayer(P1, "Ali", 200, true);
    const switched = await groupMessage(P1, "/fa");
    await switched.text();
    await evictAllDurableObjects();

    const calls = installMockTelegram();
    await dm(P1, "/balance");
    expect(texts(calls, P1)[0]).toContain("موجودی");

    const back = installMockTelegram();
    await groupMessage(P1, "/en");
    expect(texts(back, GROUP_ID)[0]).toContain("Language set to English");
  });

  it("applies the group language to DM stats and history", async () => {
    await seedPlayer(P1, "Ali", 200, true);
    await groupMessage(P1, "/fa");
    let calls = installMockTelegram();
    await dm(P1, "/stats");
    expect(texts(calls, P1)[0]).toContain("آمار شما");

    calls = installMockTelegram();
    await dm(P1, "/history");
    expect(texts(calls, P1)[0]).toContain("هنوز دستی بازی نشده");

    calls = installMockTelegram();
    await dm(P1, "/daily");
    expect(texts(calls, P1)[0]).toContain("چیپ دریافت شد");
  });
});
