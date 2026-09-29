import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetTelegramTransport, setDefaultMinEditInterval } from "../../src/telegram/api";
import {
  callbackUpdate,
  cleanStorage,
  GROUP_ID,
  getBalance,
  getTableState,
  installMockTelegram,
  lastEditText,
  lastGroupText,
  messageUpdate,
  postUpdate,
  runAlarm,
  seedPlayer,
  sentMessages,
  setRunoutDeadlineInPast,
  setTurnDeadlineInPast,
  type TelegramCall,
} from "./helpers";

const P1 = 1111;
const P2 = 2222;
const PLAYERS = [1111, 2222, 3333, 4444, 5555, 6666, 7777, 8888, 9999];

let updateCounter = 1000;

function nextUpdateId(): number {
  updateCounter += 1;
  return updateCounter;
}

async function tap(
  userId: number,
  action: string,
  options: { turnId?: number; matchId?: number; amount?: number } = {},
): Promise<Response> {
  const snapshot = await getTableState();
  const match = snapshot.match;
  const turnId = options.turnId ?? match?.turnId ?? 0;
  const matchId = options.matchId ?? snapshot.lobby?.matchId ?? match?.matchId ?? 0;
  const data =
    options.amount === undefined
      ? `m:${matchId}:${turnId}:${action}`
      : `m:${matchId}:${turnId}:${action}:${options.amount}`;
  return postUpdate(callbackUpdate(nextUpdateId(), GROUP_ID, userId, data, 1));
}

async function seedPlayers(count: number, balance = 200, dmStarted = true): Promise<void> {
  for (let i = 0; i < count; i++) {
    await seedPlayer(PLAYERS[i] as number, `Player ${i + 1}`, balance, dmStarted);
  }
}

async function startTwoPlayerHand(): Promise<TelegramCall[]> {
  await seedPlayers(2);
  const calls = installMockTelegram();
  await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/newmatch"));
  await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P2, "/join"));
  await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/deal"));
  return calls;
}

function answerTexts(calls: TelegramCall[]): string[] {
  return calls
    .filter((call) => call.method === "answerCallbackQuery")
    .map((call) => String(call.payload.text ?? ""));
}

function groupTexts(calls: TelegramCall[]): string[] {
  return sentMessages(calls, GROUP_ID).map((call) => String(call.payload.text ?? ""));
}

beforeEach(async () => {
  await cleanStorage();
  setDefaultMinEditInterval(0);
  installMockTelegram();
});

afterEach(() => {
  resetTelegramTransport();
});

describe("lobby lifecycle", () => {
  it("opens a pinned lobby, accepts joins and deals a hand", async () => {
    await seedPlayers(2);
    const calls = installMockTelegram();
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/newmatch"));
    const lobbySends = sentMessages(calls, GROUP_ID);
    expect(lobbySends).toHaveLength(1);
    expect(String(lobbySends[0]?.payload.text)).toContain("Lobby");
    expect(calls.some((call) => call.method === "pinChatMessage")).toBe(true);

    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P2, "/join"));
    expect(lastEditText(calls)).toContain("Joined (2)");

    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/deal"));
    const snapshot = await getTableState();
    expect(snapshot.lobby).toBeNull();
    expect(snapshot.match?.status).toBe("active");
    const dealText = lastGroupText(calls);
    expect(dealText).toContain("acts first");
    expect(dealText).toContain("Next:");
    expect(calls.some((call) => call.method === "unpinChatMessage")).toBe(true);
    const dms = sentMessages(calls).filter((call) => call.payload.chat_id !== GROUP_ID);
    expect(dms).toHaveLength(2);
    for (const dm of dms) {
      expect(String(dm.payload.text)).toContain("Your hand");
    }
  });

  it("opens a new lobby after a finished hand", async () => {
    await startTwoPlayerHand();
    await tap((await getTableState()).match?.actorUserId as number, "fold");
    const done = await getTableState();
    expect(done.match?.status).toBe("done");

    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P2, "/newmatch"));
    const snapshot = await getTableState();
    expect(snapshot.match).toBeNull();
    expect(snapshot.lobby).not.toBeNull();
    expect(snapshot.lobby?.starterId).toBe(P2);
  });

  it("rejects deal with fewer than two players by editing the lobby", async () => {
    await seedPlayers(1);
    const calls = installMockTelegram();
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/newmatch"));
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/deal"));
    expect(lastEditText(calls)).toContain("Need at least 2 players");
    const snapshot = await getTableState();
    expect(snapshot.lobby).not.toBeNull();
    expect(snapshot.match).toBeNull();
  });

  it("hands the lobby over when the starter leaves", async () => {
    await seedPlayers(2);
    const calls = installMockTelegram();
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/newmatch"));
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P2, "/join"));
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/leave"));
    expect(lastEditText(calls)).toContain("Take over");
    let snapshot = await getTableState();
    expect(snapshot.lobby?.starterId).toBeNull();

    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P2, "/takeover"));
    snapshot = await getTableState();
    expect(snapshot.lobby?.starterId).toBe(P2);
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/join"));
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P2, "/deal"));
    snapshot = await getTableState();
    expect(snapshot.match?.status).toBe("active");
  });

  it("rejects take over from a non-member", async () => {
    await seedPlayers(2);
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/newmatch"));
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P2, "/join"));
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/leave"));
    const calls = installMockTelegram();
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, 7777, "/takeover"));
    const snapshot = await getTableState();
    expect(snapshot.lobby?.starterId).toBeNull();
    expect(sentMessages(calls, GROUP_ID)).toHaveLength(0);
  });

  it("caps the lobby at nine players", async () => {
    await seedPlayers(10);
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/newmatch"));
    for (let i = 1; i < 9; i++) {
      await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, PLAYERS[i] as number, "/join"));
    }
    const calls = installMockTelegram();
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, PLAYERS[9] as number, "/join"));
    const snapshot = await getTableState();
    expect(snapshot.lobby?.playerIds).toHaveLength(9);
    expect(sentMessages(calls, GROUP_ID)).toHaveLength(0);
  });

  it("treats a second join as idempotent", async () => {
    await seedPlayers(2);
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/newmatch"));
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P2, "/join"));
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P2, "/join"));
    const snapshot = await getTableState();
    expect(snapshot.lobby?.playerIds).toEqual([P1, P2]);
  });

  it("stops processing updates after the bot is removed", async () => {
    await seedPlayers(1);
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/newmatch"));
    await postUpdate({
      update_id: nextUpdateId(),
      my_chat_member: {
        chat: { id: GROUP_ID, type: "supergroup", title: "Test Group" },
        from: { id: P1, first_name: "Ali", is_bot: false },
        old_chat_member: { user: { id: 999, first_name: "Bot", is_bot: true }, status: "member" },
        new_chat_member: { user: { id: 999, first_name: "Bot", is_bot: true }, status: "left" },
      },
    });
    const calls = installMockTelegram();
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/ping"));
    expect(sentMessages(calls, GROUP_ID)).toHaveLength(0);

    await postUpdate({
      update_id: nextUpdateId(),
      my_chat_member: {
        chat: { id: GROUP_ID, type: "supergroup", title: "Test Group" },
        from: { id: P1, first_name: "Ali", is_bot: false },
        old_chat_member: { user: { id: 999, first_name: "Bot", is_bot: true }, status: "left" },
        new_chat_member: { user: { id: 999, first_name: "Bot", is_bot: true }, status: "member" },
      },
    });
    calls.length = 0;
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/ping"));
    expect(sentMessages(calls, GROUP_ID)).toHaveLength(1);
  });
});

describe("onboarding", () => {
  it("requires a DM start, then joins via the deep link", async () => {
    await seedPlayer(P1, "Ali", 200, true);
    await seedPlayer(P2, "Reza", 200, false);
    const calls = installMockTelegram();
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/newmatch"));
    const snapshot = await getTableState();
    const matchId = snapshot.lobby?.matchId as number;

    await tap(P2, "join");
    expect(answerTexts(calls).some((text) => text.includes("open my DM"))).toBe(true);
    expect((await getTableState()).lobby?.playerIds).toEqual([P1]);

    await postUpdate(
      messageUpdate(nextUpdateId(), P2, P2, `/start join_${matchId}`, "private", "Reza"),
    );
    const afterJoin = await getTableState();
    expect(afterJoin.lobby?.playerIds).toEqual([P1, P2]);
    const dm = sentMessages(calls, P2);
    expect(dm.some((call) => String(call.payload.text).includes("You're in!"))).toBe(true);
  });
});

describe("betting validation", () => {
  it("alerts a non-actor privately and changes nothing", async () => {
    const calls = await startTwoPlayerHand();
    const snapshot = await getTableState();
    const actor = snapshot.match?.actorUserId as number;
    const other = actor === P1 ? P2 : P1;
    calls.length = 0;
    await tap(other, "fold");
    expect(answerTexts(calls).some((text) => text.includes("turn"))).toBe(true);
    const after = await getTableState();
    expect(after.match?.actorUserId).toBe(actor);
  });

  it("alerts a non-player privately and changes nothing", async () => {
    const calls = await startTwoPlayerHand();
    const snapshot = await getTableState();
    calls.length = 0;
    await tap(7777, "fold");
    expect(answerTexts(calls).some((text) => text.includes("not in this match"))).toBe(true);
    const after = await getTableState();
    expect(after.match?.actorUserId).toBe(snapshot.match?.actorUserId);
    expect(after.match?.pot).toBe(snapshot.match?.pot);
  });

  it("rejects stale turn ids with a private alert", async () => {
    const calls = await startTwoPlayerHand();
    const snapshot = await getTableState();
    const actor = snapshot.match?.actorUserId as number;
    const turnId = snapshot.match?.turnId as number;
    calls.length = 0;
    await tap(actor, "check", { turnId: turnId - 1 });
    expect(answerTexts(calls)).toContain("That move is no longer available");
    const after = await getTableState();
    expect(after.match?.actorUserId).toBe(actor);
    expect(after.match?.turnId).toBe(turnId);
  });

  it("rejects a raise that exceeds the cap with the legal maximum", async () => {
    const calls = await startTwoPlayerHand();
    let snapshot = await getTableState();
    const actor = snapshot.match?.actorUserId as number;
    await tap(actor, "bet", { amount: 20 });
    snapshot = await getTableState();
    calls.length = 0;
    await tap(snapshot.match?.actorUserId as number, "raise", { amount: 1000 });
    expect(answerTexts(calls).some((text) => text.includes("at most"))).toBe(true);
  });

  it("opens the raise options on the message that was tapped", async () => {
    const calls = await startTwoPlayerHand();
    calls.length = 0;
    const snapshot = await getTableState();
    await tap(snapshot.match?.actorUserId as number, "raise", {
      matchId: snapshot.match?.matchId,
      turnId: snapshot.match?.turnId,
    });
    const markup = calls.find((call) => call.method === "editMessageReplyMarkup");
    expect(markup).toBeDefined();
    expect(markup?.payload.message_id).toBe(1);
    expect(JSON.stringify(markup?.payload.reply_markup)).toContain("Bet 10");
    expect(calls.some((call) => call.method === "sendMessage")).toBe(false);
  });
});

describe("turn timeouts", () => {
  it("auto-checks the actor when the alarm fires", async () => {
    const calls = await startTwoPlayerHand();
    const before = await getTableState();
    calls.length = 0;
    await setTurnDeadlineInPast();
    const ran = await runAlarm();
    expect(ran).toBe(true);
    const after = await getTableState();
    expect(after.match?.actorUserId).not.toBe(before.match?.actorUserId);
    const texts = groupTexts(calls);
    expect(texts.some((text) => text.includes("timed out"))).toBe(true);
    expect(texts.some((text) => text.includes("Next:"))).toBe(true);
  });
});

describe("play by play", () => {
  it("posts a new message for every action with the next actor", async () => {
    const calls = await startTwoPlayerHand();
    calls.length = 0;
    const snapshot = await getTableState();
    await tap(snapshot.match?.actorUserId as number, "check");
    const texts = groupTexts(calls);
    expect(texts).toHaveLength(1);
    const text = texts[0] as string;
    expect(text).toContain("checks");
    expect(text).toContain("Still in");
    expect(text).toContain("💰 Pot");
    expect(text).toContain("⏭ Next:");
    expect(text).toContain("60s to act");
    expect(calls.some((call) => call.method === "editMessageText")).toBe(false);
    expect(calls.some((call) => call.method === "sendMessage")).toBe(true);
  });

  it("announces the winner and net result in a separate message", async () => {
    const calls = await startTwoPlayerHand();
    for (let i = 0; i < 8; i++) {
      const snapshot = await getTableState();
      if (snapshot.match?.status !== "active") {
        break;
      }
      const actor = snapshot.match.actorUserId as number;
      await tap(actor, "check");
    }
    const done = await getTableState();
    const texts = groupTexts(calls);
    const result = texts.find((text) => text.includes("🏆"));
    expect(result).toBeDefined();
    const split = (done.match?.winners.length ?? 1) > 1;
    expect(result).toContain(split ? "split" : "wins");
    if (!split) {
      expect(result).toMatch(/\(\+?\d/);
    }
    const last = texts[texts.length - 1];
    expect(last).toBe(result);
  });
});

describe("full hands", () => {
  it("plays a two-player check-down to a counted result", async () => {
    const calls = await startTwoPlayerHand();
    for (let i = 0; i < 8; i++) {
      const snapshot = await getTableState();
      if (snapshot.match?.status !== "active") {
        break;
      }
      await tap(snapshot.match.actorUserId as number, "check");
    }
    const snapshot = await getTableState();
    expect(snapshot.match?.status).toBe("done");
    const result = sentMessages(calls, GROUP_ID).find((call) =>
      String(call.payload.text).includes("🏆"),
    );
    expect(result).toBeDefined();
    const b1 = await getBalance(P1);
    const b2 = await getBalance(P2);
    expect(b1 + b2).toBe(400);
    const split = (snapshot.match?.winners.length ?? 1) > 1;
    expect([b1, b2].sort()).toEqual(split ? [200, 200] : [190, 210]);
  });

  it("completes a nine-player all-in with a full runout and effects", async () => {
    await seedPlayers(9);
    const calls = installMockTelegram();
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/newmatch"));
    for (let i = 1; i < 9; i++) {
      await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, PLAYERS[i] as number, "/join"));
    }
    await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/deal"));

    let snapshot = await getTableState();
    expect(snapshot.match?.status).toBe("active");

    let first = true;
    for (let i = 0; i < 12; i++) {
      snapshot = await getTableState();
      if (snapshot.match?.status !== "active" || snapshot.match.runout) {
        break;
      }
      await tap(snapshot.match.actorUserId as number, first ? "allin" : "call");
      first = false;
    }
    snapshot = await getTableState();
    expect(snapshot.match?.runout).toBe(true);
    expect(snapshot.match?.pot).toBe(900);

    for (let i = 0; i < 3; i++) {
      await setRunoutDeadlineInPast();
      await runAlarm();
    }
    snapshot = await getTableState();
    expect(snapshot.match?.status).toBe("done");
    expect(calls.some((call) => call.method === "sendDice" && call.payload.emoji === "🎲")).toBe(
      true,
    );
    const texts = groupTexts(calls);
    expect(texts.some((text) => text.includes("🎲 Flop:"))).toBe(true);
    expect(texts.some((text) => text.includes("🎲 Turn:"))).toBe(true);
    expect(texts.some((text) => text.includes("🎲 River:"))).toBe(true);
    const result = sentMessages(calls, GROUP_ID).find((call) =>
      String(call.payload.text).includes("🏆"),
    );
    expect(result).toBeDefined();
    let total = 0;
    for (const player of PLAYERS) {
      total += await getBalance(player);
    }
    expect(total).toBe(1800);
  });
});

describe("result actions", () => {
  it("lets a mucked loser show and opens a rematch lobby", async () => {
    const calls = await startTwoPlayerHand();
    for (let i = 0; i < 8; i++) {
      const snapshot = await getTableState();
      if (snapshot.match?.status !== "active") {
        break;
      }
      await tap(snapshot.match.actorUserId as number, "check");
    }
    const done = await getTableState();
    const matchId = done.match?.matchId as number;
    const winners = done.match?.winners as number[];
    const loser = winners.length === 1 ? (winners[0] === P1 ? P2 : P1) : null;
    calls.length = 0;
    if (loser !== null) {
      await tap(loser, "show", { matchId, turnId: 0 });
      expect(lastEditText(calls)).toContain("shows");
    }

    calls.length = 0;
    await tap(P1, "rematch", { matchId, turnId: 0 });
    const snapshot = await getTableState();
    expect(snapshot.lobby).not.toBeNull();
    expect(snapshot.lobby?.starterId).toBe(P1);
  });
});
