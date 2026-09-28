import { DurableObject } from "cloudflare:workers";

import type { AppConfig, Bindings } from "../env";
import { getConfig } from "../env";
import { TelegramApi } from "../telegram/api";
import { chatIdOf, classifyUpdate, type Intent, updateSchema } from "../telegram/bot";
import { pingText, unknownGroupText } from "../telegram/messages";
import { hashId, safeErrorMessage } from "../util/log";
import {
  getMeta,
  isUpdateProcessed,
  markUpdateProcessed,
  maybePruneUpdates,
  runMigrations,
  setMeta,
} from "./store";

const ACTIVE_STATUSES = new Set(["member", "administrator", "creator"]);

export class TableDO extends DurableObject<Bindings> {
  private readonly sql: SqlStorage;
  private readonly config: AppConfig;
  private readonly api: TelegramApi;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.config = getConfig(env as unknown as Record<string, unknown>);
    this.api = new TelegramApi(this.config.botToken);
    ctx.blockConcurrencyWhile(async () => {
      runMigrations(this.sql);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const raw = await request.text();
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return new Response("ok");
    }
    const parsed = updateSchema.safeParse(json);
    if (!parsed.success) {
      return new Response("ok");
    }
    const update = parsed.data;
    const now = Date.now();
    if (isUpdateProcessed(this.sql, update.update_id)) {
      return new Response("ok");
    }
    markUpdateProcessed(this.sql, update.update_id, now);
    maybePruneUpdates(this.sql, now);

    this.api.resetPerUpdate();
    try {
      await this.handleIntent(classifyUpdate(update));
      await this.api.flushEdits();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "update_error",
          updateId: update.update_id,
          chat: hashId(chatIdOf(update) ?? "?"),
          error: safeErrorMessage(error),
        }),
      );
      return new Response("error", { status: 500 });
    }
    return new Response("ok");
  }

  private async handleIntent(intent: Intent): Promise<void> {
    if (intent.kind === "unsupported") {
      return;
    }
    if (intent.kind === "chat_member") {
      await this.handleChatMember(intent);
      return;
    }
    const allowed =
      intent.chatType === "private" || this.config.allowedChatIds.includes(intent.chatId);
    if (!allowed) {
      await this.replyUnknownGroupOnce(intent.chatId);
      return;
    }
    if (intent.kind === "command" && intent.command === "ping") {
      await this.api.sendMessage(intent.chatId, pingText());
    }
  }

  private async handleChatMember(intent: Extract<Intent, { kind: "chat_member" }>): Promise<void> {
    const active = ACTIVE_STATUSES.has(intent.newStatus);
    setMeta(this.sql, `group_active:${intent.chatId}`, active ? "1" : "0");
    if (active && intent.chatType !== "private") {
      await this.replyUnknownGroupOnce(intent.chatId);
    }
  }

  private async replyUnknownGroupOnce(chatId: number): Promise<void> {
    const key = `unknown_group_notified:${chatId}`;
    if (getMeta(this.sql, key) !== null) {
      return;
    }
    setMeta(this.sql, key, "1");
    await this.api.sendMessage(chatId, unknownGroupText());
  }
}
