import { describe, expect, it } from "vitest";

import { classifyUpdate, parseCallbackData, updateSchema } from "../../src/telegram/bot";

const baseUpdate = {
  update_id: 1,
  message: {
    message_id: 10,
    from: { id: 42, first_name: "Ali", username: "ali", is_bot: false },
    chat: { id: -100123, type: "supergroup", title: "Family Poker" },
    text: "/deal",
  },
};

describe("updateSchema", () => {
  it("accepts a minimal group message", () => {
    const parsed = updateSchema.safeParse(baseUpdate);
    expect(parsed.success).toBe(true);
  });

  it("rejects payloads without update_id", () => {
    const parsed = updateSchema.safeParse({ message: baseUpdate.message });
    expect(parsed.success).toBe(false);
  });

  it("accepts updates with only unknown fields", () => {
    const parsed = updateSchema.safeParse({ update_id: 2, edited_message: { foo: 1 } });
    expect(parsed.success).toBe(true);
  });
});

describe("classifyUpdate", () => {
  it("classifies commands and strips the bot mention", () => {
    const parsed = updateSchema.parse({
      ...baseUpdate,
      message: { ...baseUpdate.message, text: "/raise@dailypoker_bot 40" },
    });
    const intent = classifyUpdate(parsed);
    expect(intent.kind).toBe("command");
    if (intent.kind === "command") {
      expect(intent.command).toBe("raise");
      expect(intent.args).toBe("40");
      expect(intent.isDm).toBe(false);
      expect(intent.chatId).toBe(-100123);
    }
  });

  it("classifies plain text", () => {
    const parsed = updateSchema.parse({
      ...baseUpdate,
      message: { ...baseUpdate.message, text: "hello table" },
    });
    const intent = classifyUpdate(parsed);
    expect(intent.kind).toBe("text");
  });

  it("classifies callbacks", () => {
    const parsed = updateSchema.parse({
      update_id: 3,
      callback_query: {
        id: "cb-1",
        from: { id: 42, first_name: "Ali", is_bot: false },
        message: { message_id: 10, chat: { id: -100123, type: "supergroup" } },
        data: "m:5:3:call",
      },
    });
    const intent = classifyUpdate(parsed);
    expect(intent.kind).toBe("callback");
    if (intent.kind === "callback") {
      expect(intent.data).toBe("m:5:3:call");
      expect(intent.userId).toBe(42);
    }
  });

  it("classifies my_chat_member updates", () => {
    const parsed = updateSchema.parse({
      update_id: 4,
      my_chat_member: {
        chat: { id: -100123, type: "supergroup", title: "Family Poker" },
        from: { id: 42, first_name: "Ali", is_bot: false },
        old_chat_member: {
          user: { id: 7, first_name: "Daily Poker", is_bot: true },
          status: "left",
        },
        new_chat_member: {
          user: { id: 7, first_name: "Daily Poker", is_bot: true },
          status: "member",
        },
      },
    });
    const intent = classifyUpdate(parsed);
    expect(intent.kind).toBe("chat_member");
    if (intent.kind === "chat_member") {
      expect(intent.newStatus).toBe("member");
      expect(intent.targetIsBot).toBe(true);
    }
  });
});

describe("parseCallbackData", () => {
  it("parses the documented schema", () => {
    expect(parseCallbackData("m:12:34:allin")).toEqual({
      matchId: 12,
      turnId: 34,
      action: "allin",
    });
  });

  it("rejects unknown actions", () => {
    expect(parseCallbackData("m:12:34:hack")).toBeNull();
  });

  it("rejects malformed data", () => {
    expect(parseCallbackData("bogus")).toBeNull();
    expect(parseCallbackData("m:1:2")).toBeNull();
    expect(parseCallbackData("m:a:b:call")).toBeNull();
    expect(parseCallbackData("m:99999999999999999999:1:call")).toBeNull();
  });
});
