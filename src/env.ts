import { z } from "zod";

export interface AppConfig {
  botToken: string;
  botUsername: string;
  allowedChatIds: number[];
  ownerUserId: number;
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
  ALLOWED_CHAT_IDS: chatIdList,
  OWNER_USER_ID: z.coerce.number().int().nonnegative(),
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
    allowedChatIds: data.ALLOWED_CHAT_IDS,
    ownerUserId: data.OWNER_USER_ID,
  };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return parseConfig(env);
}
