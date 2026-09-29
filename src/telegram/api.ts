import { EDIT_MIN_INTERVAL_MS, SEND_CAP_PER_UPDATE } from "../config";
import { sleep } from "../util/time";

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
}

export interface SendMessageOptions {
  reply_markup?: InlineKeyboardMarkup;
  reply_parameters?: { message_id: number };
  link_preview_options?: { is_disabled?: boolean };
  disable_notification?: boolean;
}

export interface EditMessageOptions {
  reply_markup?: InlineKeyboardMarkup;
}

export interface AnswerCallbackOptions {
  text?: string;
  show_alert?: boolean;
}

interface TelegramErrorResponse {
  ok: false;
  error_code: number;
  description: string;
  parameters?: { retry_after?: number };
}

interface TelegramOkResponse<T> {
  ok: true;
  result: T;
}

type TelegramResponse<T> = TelegramOkResponse<T> | TelegramErrorResponse;

export class TelegramError extends Error {
  constructor(
    readonly method: string,
    readonly errorCode: number,
    readonly description: string,
  ) {
    super(`telegram ${method} failed (${errorCode}): ${description}`);
    this.name = "TelegramError";
  }
}

export class SendCapExceededError extends Error {
  constructor() {
    super("per-update send cap exceeded");
    this.name = "SendCapExceededError";
  }
}

let transport: typeof fetch = (input, init) => fetch(input, init);
let defaultMinEditIntervalMs = EDIT_MIN_INTERVAL_MS;

export function setTelegramTransport(next: typeof fetch): void {
  transport = next;
}

export function resetTelegramTransport(): void {
  transport = (input, init) => fetch(input, init);
}

export function setDefaultMinEditInterval(ms: number): void {
  defaultMinEditIntervalMs = ms;
}

interface PendingEdit {
  chatId: number;
  messageId: number;
  text: string;
  options: EditMessageOptions;
}

const MAX_RETRY_WAIT_MS = 30_000;
const MAX_RATE_LIMIT_RETRIES = 2;

export class TelegramApi {
  private sendsThisUpdate = 0;
  private readonly pendingEdits = new Map<number, PendingEdit>();
  private readonly lastEditAt = new Map<number, number>();

  constructor(
    private readonly token: string,
    private readonly sendCap: number = SEND_CAP_PER_UPDATE,
    private readonly minEditIntervalMs: number = defaultMinEditIntervalMs,
  ) {}

  resetPerUpdate(): void {
    this.sendsThisUpdate = 0;
    this.pendingEdits.clear();
  }

  async call<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const response = await transport(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as TelegramResponse<T>;
      if (data.ok) {
        return data.result;
      }
      const retryAfterMs = (data.parameters?.retry_after ?? 0) * 1000;
      if (data.error_code === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        await sleep(Math.min(retryAfterMs || 1000, MAX_RETRY_WAIT_MS));
        continue;
      }
      throw new TelegramError(method, data.error_code, data.description);
    }
  }

  async sendMessage(
    chatId: number,
    text: string,
    options: SendMessageOptions = {},
  ): Promise<TelegramMessage | null> {
    this.sendsThisUpdate++;
    if (this.sendsThisUpdate > this.sendCap) {
      throw new SendCapExceededError();
    }
    return this.call<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...options,
    });
  }

  queueEdit(
    chatId: number,
    messageId: number,
    text: string,
    options: EditMessageOptions = {},
  ): void {
    this.pendingEdits.set(messageId, { chatId, messageId, text, options });
  }

  async flushEdits(): Promise<void> {
    for (const edit of this.pendingEdits.values()) {
      this.sendsThisUpdate++;
      if (this.sendsThisUpdate > this.sendCap) {
        throw new SendCapExceededError();
      }
      const last = this.lastEditAt.get(edit.messageId) ?? 0;
      const elapsed = Date.now() - last;
      if (elapsed < this.minEditIntervalMs) {
        await sleep(this.minEditIntervalMs - elapsed);
      }
      await this.call("editMessageText", {
        chat_id: edit.chatId,
        message_id: edit.messageId,
        text: edit.text,
        parse_mode: "HTML",
        ...edit.options,
      });
      this.lastEditAt.set(edit.messageId, Date.now());
    }
    this.pendingEdits.clear();
  }

  async answerCallbackQuery(
    callbackId: string,
    options: AnswerCallbackOptions = {},
  ): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: callbackId, ...options });
  }

  async editMessageReplyMarkup(
    chatId: number,
    messageId: number,
    replyMarkup: InlineKeyboardMarkup,
  ): Promise<void> {
    await this.call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    });
  }

  async sendDice(chatId: number, emoji = "🎲"): Promise<TelegramMessage | null> {
    this.sendsThisUpdate++;
    if (this.sendsThisUpdate > this.sendCap) {
      throw new SendCapExceededError();
    }
    return this.call<TelegramMessage>("sendDice", { chat_id: chatId, emoji });
  }
}
