import { afterEach, beforeEach, expect, it } from "vitest";

import { resetTelegramTransport, setDefaultMinEditInterval } from "../../src/telegram/api";
import {
  callbackUpdate,
  cleanStorage,
  GROUP_ID,
  getTableState,
  installMockTelegram,
  messageUpdate,
  postUpdate,
  runAlarm,
  seedPlayer,
  setRunoutDeadlineInPast,
} from "../do/helpers";

const P1 = 1111;
const P2 = 2222;

let updateCounter = 5000;

function nextUpdateId(): number {
  updateCounter += 1;
  return updateCounter;
}

beforeEach(async () => {
  await cleanStorage();
  setDefaultMinEditInterval(0);
});

afterEach(() => {
  resetTelegramTransport();
});

it("sends no dice messages when effects are disabled", async () => {
  await seedPlayer(P1, "Ali", 200, true);
  await seedPlayer(P2, "Reza", 200, true);
  const calls = installMockTelegram();
  await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/newmatch"));
  await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P2, "/join"));
  await postUpdate(messageUpdate(nextUpdateId(), GROUP_ID, P1, "/deal"));

  let snapshot = await getTableState();
  const actor = snapshot.match?.actorUserId as number;
  await postUpdate(
    callbackUpdate(
      nextUpdateId(),
      GROUP_ID,
      actor,
      `m:${snapshot.match?.matchId}:${snapshot.match?.turnId}:allin`,
      1,
    ),
  );
  snapshot = await getTableState();
  await postUpdate(
    callbackUpdate(
      nextUpdateId(),
      GROUP_ID,
      snapshot.match?.actorUserId as number,
      `m:${snapshot.match?.matchId}:${snapshot.match?.turnId}:call`,
      1,
    ),
  );
  for (let i = 0; i < 3; i++) {
    await setRunoutDeadlineInPast();
    await runAlarm();
  }
  snapshot = await getTableState();
  expect(snapshot.match?.status).toBe("done");
  expect(snapshot.match?.pot).toBe(200);
  expect(calls.some((call) => call.method === "sendDice")).toBe(false);
});
