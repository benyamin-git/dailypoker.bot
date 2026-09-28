import { z } from "zod";

export const userSchema = z.object({
  id: z.number().int(),
  first_name: z.string(),
  username: z.string().nullish(),
  is_bot: z.boolean().optional(),
});

export const chatSchema = z.object({
  id: z.number().int(),
  type: z.enum(["private", "group", "supergroup", "channel"]),
  title: z.string().nullish(),
});

const messageSchema = z.object({
  message_id: z.number().int(),
  from: userSchema.optional(),
  chat: chatSchema,
  text: z.string().optional(),
});

const callbackQuerySchema = z.object({
  id: z.string(),
  from: userSchema,
  message: z
    .object({
      message_id: z.number().int(),
      chat: chatSchema,
    })
    .optional(),
  data: z.string().optional(),
});

const chatMemberSchema = z.object({
  user: userSchema,
  status: z.string(),
});

const myChatMemberSchema = z.object({
  chat: chatSchema,
  from: userSchema,
  new_chat_member: chatMemberSchema,
  old_chat_member: chatMemberSchema,
});

export const updateSchema = z.object({
  update_id: z.number().int(),
  message: messageSchema.optional(),
  callback_query: callbackQuerySchema.optional(),
  my_chat_member: myChatMemberSchema.optional(),
});

export type ParsedUpdate = z.infer<typeof updateSchema>;
export type ChatType = z.infer<typeof chatSchema>["type"];

export interface TelegramUser {
  id: number;
  firstName: string;
  username: string | null;
  isBot: boolean;
}

interface IntentBase {
  chatId: number;
  chatType: ChatType;
  chatTitle: string | null;
  userId: number;
  user: TelegramUser;
  isDm: boolean;
}

export type Intent =
  | (IntentBase & {
      kind: "command";
      command: string;
      args: string;
      messageId: number;
    })
  | (IntentBase & {
      kind: "text";
      text: string;
      messageId: number;
    })
  | (IntentBase & {
      kind: "callback";
      data: string;
      callbackId: string;
      messageId: number;
    })
  | (IntentBase & {
      kind: "chat_member";
      newStatus: string;
      oldStatus: string;
      targetIsBot: boolean;
    })
  | { kind: "unsupported" };

export interface CallbackData {
  matchId: number;
  turnId: number;
  action: string;
  amount?: number;
}

export const CALLBACK_ACTIONS = [
  "join",
  "leave",
  "deal",
  "cancel",
  "takeover",
  "fold",
  "check",
  "call",
  "bet",
  "raise",
  "allin",
  "show",
  "rematch",
  "cards",
  "raisecustom",
] as const;

export function parseCallbackData(data: string): CallbackData | null {
  const match = /^m:(\d+):(\d+):([a-z]+)(?::(\d+))?$/.exec(data);
  if (!match) {
    return null;
  }
  const matchId = Number(match[1]);
  const turnId = Number(match[2]);
  const action = match[3] as string;
  const amount = match[4] === undefined ? undefined : Number(match[4]);
  if (!Number.isSafeInteger(matchId) || !Number.isSafeInteger(turnId)) {
    return null;
  }
  if (!(CALLBACK_ACTIONS as readonly string[]).includes(action)) {
    return null;
  }
  if (amount !== undefined && !Number.isSafeInteger(amount)) {
    return null;
  }
  return amount === undefined ? { matchId, turnId, action } : { matchId, turnId, action, amount };
}

function toUser(user: z.infer<typeof userSchema>): TelegramUser {
  return {
    id: user.id,
    firstName: user.first_name,
    username: user.username ?? null,
    isBot: user.is_bot ?? false,
  };
}

function parseCommand(text: string): { command: string; args: string } | null {
  if (!text.startsWith("/")) {
    return null;
  }
  const [head = "", ...rest] = text.split(/\s+/);
  const command = (head.split("@")[0] ?? "").slice(1).toLowerCase();
  if (!/^[a-z0-9_]{1,32}$/.test(command)) {
    return null;
  }
  return { command, args: rest.join(" ").trim() };
}

export function chatIdOf(update: ParsedUpdate): number | undefined {
  return (
    update.message?.chat.id ??
    update.callback_query?.message?.chat.id ??
    update.my_chat_member?.chat.id
  );
}

export function chatInfoOf(update: ParsedUpdate): { id: number; type: ChatType } | undefined {
  const chat =
    update.message?.chat ?? update.callback_query?.message?.chat ?? update.my_chat_member?.chat;
  return chat === undefined ? undefined : { id: chat.id, type: chat.type };
}

export function classifyUpdate(update: ParsedUpdate): Intent {
  const message = update.message;
  if (message?.from && message.text !== undefined) {
    const from = message.from;
    const base: IntentBase = {
      chatId: message.chat.id,
      chatType: message.chat.type,
      chatTitle: message.chat.title ?? null,
      userId: from.id,
      user: toUser(from),
      isDm: message.chat.type === "private",
    };
    const parsedCommand = parseCommand(message.text);
    if (parsedCommand) {
      return {
        ...base,
        kind: "command",
        command: parsedCommand.command,
        args: parsedCommand.args,
        messageId: message.message_id,
      };
    }
    return { ...base, kind: "text", text: message.text, messageId: message.message_id };
  }

  const query = update.callback_query;
  if (query?.message) {
    if (query.data === undefined) {
      return { kind: "unsupported" };
    }
    return {
      chatId: query.message.chat.id,
      chatType: query.message.chat.type,
      chatTitle: query.message.chat.title ?? null,
      userId: query.from.id,
      user: toUser(query.from),
      isDm: query.message.chat.type === "private",
      kind: "callback",
      data: query.data,
      callbackId: query.id,
      messageId: query.message.message_id,
    };
  }

  const member = update.my_chat_member;
  if (member) {
    return {
      chatId: member.chat.id,
      chatType: member.chat.type,
      chatTitle: member.chat.title ?? null,
      userId: member.from.id,
      user: toUser(member.from),
      isDm: member.chat.type === "private",
      kind: "chat_member",
      newStatus: member.new_chat_member.status,
      oldStatus: member.old_chat_member.status,
      targetIsBot: member.new_chat_member.user.is_bot ?? false,
    };
  }

  return { kind: "unsupported" };
}
