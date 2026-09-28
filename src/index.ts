import type { AppConfig, Bindings } from "./env";
import { getConfig } from "./env";
import { TelegramApi } from "./telegram/api";
import { chatInfoOf, updateSchema } from "./telegram/bot";
import { GROUP_COMMANDS, PRIVATE_COMMANDS } from "./telegram/commands";
import { constantTimeEqual } from "./util/crypto";
import { safeErrorMessage } from "./util/log";

export { TableDO } from "./game/table-do";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handleWebhook(
  request: Request,
  env: Bindings,
  config: AppConfig,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!constantTimeEqual(secretHeader, config.webhookSecret)) {
    return new Response("Forbidden", { status: 403 });
  }
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
  const chat = chatInfoOf(parsed.data);
  if (chat === undefined) {
    return new Response("ok");
  }
  const targetId = chat.type === "private" ? config.allowedChatIds[0] : chat.id;
  const stub = env.TABLE.get(env.TABLE.idFromName(String(targetId)));
  const response = await stub.fetch("https://table.internal/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  });
  return new Response(response.body, { status: response.status });
}

async function handleAdmin(
  operation: string,
  request: Request,
  config: AppConfig,
  origin: string,
): Promise<Response> {
  const api = new TelegramApi(config.botToken);
  switch (operation) {
    case "register-webhook": {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const result = await api.call("setWebhook", {
        url: `${origin}/tg/${config.webhookPath}`,
        secret_token: config.webhookSecret,
        allowed_updates: ["message", "callback_query", "my_chat_member"],
        drop_pending_updates: true,
      });
      return jsonResponse(result);
    }
    case "webhook-info": {
      if (request.method !== "GET" && request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const result = await api.call("getWebhookInfo", {});
      return jsonResponse(result);
    }
    case "delete-webhook": {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const result = await api.call("deleteWebhook", { drop_pending_updates: false });
      return jsonResponse(result);
    }
    case "set-commands": {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const group = await api.call("setMyCommands", {
        commands: GROUP_COMMANDS,
        scope: { type: "all_group_chats" },
      });
      const priv = await api.call("setMyCommands", {
        commands: PRIVATE_COMMANDS,
        scope: { type: "all_private_chats" },
      });
      return jsonResponse({ group, private: priv });
    }
    default:
      return new Response("Not Found", { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    let config: AppConfig;
    try {
      config = getConfig(env as unknown as Record<string, unknown>);
    } catch (error) {
      console.error(JSON.stringify({ event: "env_invalid", error: safeErrorMessage(error) }));
      return new Response("misconfigured", { status: 500 });
    }

    const url = new URL(request.url);
    const prefix = `/tg/${config.webhookPath}`;
    if (url.pathname === prefix) {
      return handleWebhook(request, env, config);
    }
    const adminPrefix = `${prefix}/admin/`;
    if (url.pathname.startsWith(adminPrefix)) {
      const adminKey = request.headers.get("x-admin-key") ?? "";
      if (!constantTimeEqual(adminKey, config.adminKey)) {
        return new Response("Forbidden", { status: 403 });
      }
      return handleAdmin(url.pathname.slice(adminPrefix.length), request, config, url.origin);
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Bindings>;
