import { z } from "zod";

import type { TableDO } from "./game/table-do";

export interface Bindings {
  TABLE: DurableObjectNamespace<TableDO>;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  ADMIN_KEY: string;
  ALLOWED_CHAT_IDS: string;
  OWNER_USER_ID: string;
  BOT_USERNAME: string;
  WEBHOOK_PATH: string;
  EFFECTS_ENABLED: string;
}

export interface AppConfig {
  botToken: string;
  botUsername: string;
  webhookSecret: string;
  adminKey: string;
  webhookPath: string;
  allowedChatIds: number[];
  ownerUserId: number;
  effectsEnabled: boolean;
}

const chatIdList = z
  .string()
  .transform((value, ctx) => {
    const parts = value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const ids: number[] = [];
    for (const part of parts) {
      const id = Number(part);
      if (!Number.isSafeInteger(id)) {
        ctx.addIssue({ code: "custom", message: `invalid chat id: ${part}` });
        return z.NEVER;
      }
      ids.push(id);
    }
    return ids;
  })
  .pipe(z.array(z.number().int()).length(1));

const configSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  BOT_USERNAME: z.string().min(1),
  WEBHOOK_SECRET: z.string().min(16),
  ADMIN_KEY: z.string().min(16),
  WEBHOOK_PATH: z.string().min(8),
  ALLOWED_CHAT_IDS: chatIdList,
  OWNER_USER_ID: z.coerce.number().int().nonnegative(),
  EFFECTS_ENABLED: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export function parseConfig(env: Record<string, unknown>): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`invalid environment: ${issues.join("; ")}`);
  }
  const data = parsed.data;
  return {
    botToken: data.BOT_TOKEN,
    botUsername: data.BOT_USERNAME,
    webhookSecret: data.WEBHOOK_SECRET,
    adminKey: data.ADMIN_KEY,
    webhookPath: data.WEBHOOK_PATH,
    allowedChatIds: data.ALLOWED_CHAT_IDS,
    ownerUserId: data.OWNER_USER_ID,
    effectsEnabled: data.EFFECTS_ENABLED,
  };
}

let cachedEnv: Record<string, unknown> | undefined;
let cachedConfig: AppConfig | undefined;

export function getConfig(env: Record<string, unknown>): AppConfig {
  if (cachedEnv === env && cachedConfig) {
    return cachedConfig;
  }
  const config = parseConfig(env);
  cachedEnv = env;
  cachedConfig = config;
  return config;
}

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}
