import { openDatabase } from "./db";
import { loadConfig } from "./env";
import * as store from "./game/store";
import { Table } from "./game/table";
import { ALLOWED_UPDATES, pollOnce } from "./polling";
import { TelegramApi, TelegramError } from "./telegram/api";
import { GROUP_COMMANDS, PRIVATE_COMMANDS } from "./telegram/commands";
import { safeErrorMessage } from "./util/log";
import { sleep } from "./util/time";

const config = loadConfig();
const db = openDatabase(process.env.DB_PATH ?? "data/dailypoker.db");
const api = new TelegramApi(config.botToken);
const table = new Table(config, db);

let queue: Promise<void> = Promise.resolve();
function serial(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task, task);
  return queue;
}

async function configure(): Promise<void> {
  const firstPoll = store.getMeta(db, "polling_initialized") !== "1";
  await api.call("deleteWebhook", { drop_pending_updates: firstPoll });
  store.setMeta(db, "polling_initialized", "1");
  try {
    await api.call("setMyCommands", {
      commands: GROUP_COMMANDS,
      scope: { type: "all_group_chats" },
    });
    await api.call("setMyCommands", {
      commands: PRIVATE_COMMANDS,
      scope: { type: "all_private_chats" },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "commands_failed", error: safeErrorMessage(error) }));
  }
}

async function main(): Promise<void> {
  await configure();
  console.log(JSON.stringify({ event: "polling_started", bot: config.botUsername }));

  setInterval(() => void serial(() => table.tick()), 1000);
  let offset = 0;
  let retryMs = 1000;
  for (;;) {
    try {
      offset = await pollOnce(
        (next) =>
          api.call<unknown[]>("getUpdates", {
            offset: next,
            timeout: 30,
            allowed_updates: ALLOWED_UPDATES,
          }),
        (update) => serial(() => table.handleUpdate(update)),
        offset,
      );
      retryMs = 1000;
    } catch (error) {
      if (error instanceof TelegramError && error.errorCode === 409) {
        try {
          await api.call("deleteWebhook", { drop_pending_updates: true });
        } catch {
          // the next getUpdates retry reports anything still broken
        }
      }
      console.error(JSON.stringify({ event: "poll_error", error: safeErrorMessage(error) }));
      await sleep(retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    }
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "fatal", error: safeErrorMessage(error) }));
  process.exit(1);
});
