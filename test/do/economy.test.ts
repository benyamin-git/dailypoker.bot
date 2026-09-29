import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTelegramTransport, setDefaultMinEditInterval } from "../../src/telegram/api";
import { formatAmount } from "../../src/telegram/messages";
import {
  callbackUpdate,
  cleanStorage,
  countRows,
  GROUP_ID,
  getBalance,
  getPlayerRow,
  getTableState,
  insertFakeMatches,
  insertScriptedCorpus,
  installMockTelegram,
  messageUpdate,
  postUpdate,
  runPruneMatches,
  seedPlayer,
  sentMessages,
  setBalance,
  setLastDailyAt,
  type TelegramCall,
} from "./helpers";

const P1 = 1111;
const P2 = 2222;
const P3 = 3333;
const P4 = 4444;
const OWNER = 424242;

let updateCounter = 3000;

function nextUpdateId(): number {
  updateCounter += 1;
  return updateCounter;
}

const NAMES: Record<number, string> = {
  [P1]: "Ali",
  [P2]: "Reza",
  [P3]: "Sara",
  [P4]: "Nina",
  [OWNER]: "Owner",
};

function nameOf(userId: number): string {
  return NAMES[userId] ?? "Player";
}

function dm(userId: number, text: string): Promise<Response> {
  return postUpdate(messageUpdate(nextUpdateId(), userId, userId, text, "private", nameOf(userId)));
}

function groupMessage(userId: number, text: string): Promise<Response> {
  return postUpdate(
    messageUpdate(nextUpdateId(), GROUP_ID, userId, text, "supergroup", nameOf(userId)),
  );
}

function groupTap(userId: number, data: string): Promise<Response> {
  return postUpdate({
    update_id: nextUpdateId(),
    callback_query: {
      id: `cb-${nextUpdateId()}`,
      from: { id: userId, first_name: nameOf(userId), is_bot: false },
      message: {
        message_id: 1,
        chat: { id: GROUP_ID, type: "supergroup", title: "Test Group" },
      },
      data,
    },
  });
}

function texts(calls: TelegramCall[], chatId?: number): string[] {
  return sentMessages(calls, chatId).map((call) => String(call.payload.text ?? ""));
}

async function playCheckDownHand(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const snapshot = await getTableState();
    if (snapshot.match?.status !== "active") {
      break;
    }
    const matchId = snapshot.match.matchId;
    const turnId = snapshot.match.turnId;
    await groupTap(snapshot.match.actorUserId as number, `m:${matchId}:${turnId}:check`);
  }
}

beforeEach(async () => {
  await cleanStorage();
  setDefaultMinEditInterval(0);
  installMockTelegram();
});

afterEach(() => {
  resetTelegramTransport();
});

describe("daily claim", () => {
  it("grants chips once per rolling 24h and posts a group teaser", async () => {
    await seedPlayer(P1, "Ali", 0, true);
    const calls = installMockTelegram();
    await dm(P1, "/daily");
    let row = await getPlayerRow(P1);
    expect(row?.balance).toBe(200);
    expect(Number(row?.last_daily_at)).toBeGreaterThan(0);
    expect(texts(calls, P1)[0]).toContain("+200 chips claimed");
    expect(texts(calls, GROUP_ID)[0]).toContain("Ali");

    calls.length = 0;
    await dm(P1, "/daily");
    expect(texts(calls, P1)[0]).toContain("Already claimed");
    row = await getPlayerRow(P1);
    expect(row?.balance).toBe(200);

    await setLastDailyAt(P1, Date.now() - 25 * 60 * 60 * 1000);
    calls.length = 0;
    await dm(P1, "/daily");
    row = await getPlayerRow(P1);
    expect(row?.balance).toBe(400);
    expect(texts(calls, P1)[0]).toContain("+200 chips claimed");
  });

  it("verifies the cooldown with a fake clock", async () => {
    await seedPlayer(P1, "Ali", 0, true);
    const spy = vi.spyOn(Date, "now");
    const base = 1_800_000_000_000;
    spy.mockReturnValue(base);
    try {
      const calls = installMockTelegram();
      await dm(P1, "/daily");
      expect(await getBalance(P1)).toBe(200);

      spy.mockReturnValue(base + 23 * 60 * 60 * 1000);
      calls.length = 0;
      await dm(P1, "/daily");
      expect(await getBalance(P1)).toBe(200);
      expect(texts(calls, P1)[0]).toContain("Already claimed");

      spy.mockReturnValue(base + 24 * 60 * 60 * 1000 + 1);
      calls.length = 0;
      await dm(P1, "/daily");
      expect(await getBalance(P1)).toBe(400);
    } finally {
      spy.mockRestore();
    }
  });

  it("allows a daily claim during an active hand", async () => {
    await seedPlayer(P1, "Ali", 200, true);
    await seedPlayer(P2, "Reza", 200, true);
    await groupMessage(P1, "/newmatch");
    await groupMessage(P2, "/join");
    await groupMessage(P1, "/deal");
    const before = await getTableState();
    await dm(P1, "/daily");
    expect(await getBalance(P1)).toBe(390);
    const after = await getTableState();
    expect(after.match?.actorUserId).toBe(before.match?.actorUserId);
    expect(after.match?.pot).toBe(before.match?.pot);
  });
});

describe("eligibility", () => {
  it("allows a player with exactly the minimum balance to join", async () => {
    await seedPlayer(P1, "Ali", 200, true);
    await seedPlayer(P2, "Reza", 100, true);
    await groupMessage(P1, "/newmatch");
    await groupMessage(P2, "/join");
    const snapshot = await getTableState();
    expect(snapshot.lobby?.playerIds).toEqual([P1, P2]);
  });

  it("blocks broke players until they claim again", async () => {
    await seedPlayer(P1, "Ali", 200, true);
    await setBalance(P1, 0);
    const calls = installMockTelegram();
    await groupMessage(P1, "/newmatch");
    expect((await getTableState()).lobby).toBeNull();
    expect(texts(calls, P1).some((text) => text.includes("at least 100"))).toBe(true);

    calls.length = 0;
    await dm(P1, "/daily");
    await groupMessage(P1, "/newmatch");
    expect((await getTableState()).lobby).not.toBeNull();
  });
});

describe("balance, stats and history", () => {
  it("reports stats and history consistent with played hands", async () => {
    await seedPlayer(P1, "Ali", 200, true);
    await seedPlayer(P2, "Reza", 200, true);
    const calls = installMockTelegram();

    await groupMessage(P1, "/newmatch");
    await groupMessage(P2, "/join");
    await groupMessage(P1, "/deal");
    await playCheckDownHand();

    await groupMessage(P1, "/newmatch");
    await groupMessage(P2, "/join");
    await groupMessage(P1, "/deal");
    await playCheckDownHand();

    const balance = await getBalance(P1);
    const net = balance - 200;

    calls.length = 0;
    await dm(P1, "/stats");
    const stats = texts(calls, P1)[0] as string;
    expect(stats).toContain("Hands: 2");
    expect(stats).toMatch(/Wins: [0-2] \(/);
    expect(stats).toContain(`Net: ${net >= 0 ? "+" : ""}${formatAmount(net)}`);

    calls.length = 0;
    await dm(P1, "/history");
    const history = texts(calls, P1)[0] as string;
    expect(history).toContain("#2");
    expect(history).toContain("#1");
    expect(history).toContain("board:");

    calls.length = 0;
    await dm(P1, "/balance");
    const balanceText = texts(calls, P1)[0] as string;
    expect(balanceText).toContain(`Balance: ${formatAmount(balance)} chips`);
    expect(balanceText).toContain("Record: 2 hands");

    calls.length = 0;
    await groupMessage(P1, "/top");
    const top = texts(calls, GROUP_ID)[0] as string;
    expect(top).toContain("Leaderboard");
    const order = top.indexOf("Ali") < top.indexOf("Reza");
    expect(order).toBe(balance >= (await getBalance(P2)));
  });

  it("matches stats and history to a 50-hand scripted corpus", async () => {
    await seedPlayer(P1, "Ali", 200, true);
    await seedPlayer(P2, "Reza", 200, true);
    const calls = installMockTelegram();
    await insertScriptedCorpus(50, P1, P2);

    await dm(P1, "/stats");
    const stats = texts(calls, P1)[0] as string;
    expect(stats).toContain("Hands: 50 · Wins: 25 (50%)");
    expect(stats).toContain("Net: +0");

    calls.length = 0;
    await dm(P1, "/history 20");
    const history = texts(calls, P1)[0] as string;
    const lines = history.split("\n").filter((line) => line.startsWith("#"));
    expect(lines).toHaveLength(20);
    expect(lines[0]).toContain("#50");
    expect(lines[19]).toContain("#31");
  });

  it("keeps balances non-negative after losing all-in", async () => {
    await seedPlayer(P1, "Ali", 100, true);
    await seedPlayer(P2, "Reza", 200, true);
    await groupMessage(P1, "/newmatch");
    await groupMessage(P2, "/join");
    await groupMessage(P1, "/deal");
    let snapshot = await getTableState();
    const actor = snapshot.match?.actorUserId as number;
    await groupTap(actor, `m:${snapshot.match?.matchId}:${snapshot.match?.turnId}:allin`);
    snapshot = await getTableState();
    await groupTap(
      snapshot.match?.actorUserId as number,
      `m:${snapshot.match?.matchId}:${snapshot.match?.turnId}:call`,
    );
    expect(await getBalance(P1)).toBeGreaterThanOrEqual(0);
    expect(await getBalance(P2)).toBeGreaterThanOrEqual(0);
    expect(await getBalance(P1)).toBeLessThanOrEqual(200);
  });
});

describe("owner commands", () => {
  it("rejects non-owners and answers the owner", async () => {
    await seedPlayer(P2, "Reza", 200, true);
    let calls = installMockTelegram();
    await dm(P2, "/version");
    expect(texts(calls, P2).some((text) => text.includes("Owner only."))).toBe(true);

    calls = installMockTelegram();
    await dm(OWNER, "/version");
    const version = texts(calls, OWNER)[0] as string;
    expect(version).toContain("dailypoker.bot v0.1.0");
    expect(version).toContain("example.com");
  });

  it("wipes group storage only after the owner arms reset and types RESET", async () => {
    await seedPlayer(P1, "Ali", 200, true);
    await groupMessage(P1, "/newmatch");
    let calls = installMockTelegram();

    await dm(P2, "/resetgroup");
    expect(texts(calls, P2)[0]).toContain("Owner only.");

    calls = installMockTelegram();
    await dm(OWNER, "RESET");
    expect(texts(calls, OWNER)[0]).toContain("Nothing to confirm");

    calls = installMockTelegram();
    await dm(OWNER, "/resetgroup");
    expect(texts(calls, OWNER)[0]).toContain("type RESET");
    const markup = sentMessages(calls, OWNER)[0]?.payload.reply_markup as {
      inline_keyboard: { callback_data?: string }[][];
    };
    expect(markup.inline_keyboard[0]?.[0]?.callback_data).toBe("rg:arm");

    calls = installMockTelegram();
    await postUpdate(callbackUpdate(nextUpdateId(), P2, P2, "rg:arm", 1, "private", "Reza"));
    expect(
      calls.some(
        (call) =>
          call.method === "answerCallbackQuery" &&
          String(call.payload.text).includes("Owner only."),
      ),
    ).toBe(true);

    calls = installMockTelegram();
    await postUpdate(callbackUpdate(nextUpdateId(), OWNER, OWNER, "rg:arm", 1, "private", "Owner"));
    expect(texts(calls, OWNER)[0]).toContain("Armed");

    calls = installMockTelegram();
    await dm(OWNER, "reset");
    expect(texts(calls, OWNER)[0]).toContain("not the confirmation word");

    await dm(P2, "RESET");
    expect(await countRows("players")).toBeGreaterThan(0);

    calls = installMockTelegram();
    await dm(OWNER, "RESET");
    expect(texts(calls, OWNER)[0]).toContain("wiped");
    expect(await countRows("players")).toBe(0);
    expect(await countRows("matches")).toBe(0);
    const snapshot = await getTableState();
    expect(snapshot.lobby).toBeNull();
  });
});

describe("retention", () => {
  it("prunes matches down to the newest thousand", async () => {
    await insertFakeMatches(1100);
    expect(await countRows("matches")).toBe(1100);
    await runPruneMatches();
    expect(await countRows("matches")).toBe(1000);
  });
});
