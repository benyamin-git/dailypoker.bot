import { afterEach, describe, expect, it, vi } from "vitest";

import { resetTelegramTransport, setTelegramTransport, TelegramApi } from "../../src/telegram/api";

afterEach(() => {
  resetTelegramTransport();
  vi.useRealTimers();
});

describe("TelegramApi.call", () => {
  it("aborts a request that never answers", async () => {
    vi.useFakeTimers();
    setTelegramTransport(((input: Request | string | URL, init?: RequestInit) => {
      void input;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }) as typeof fetch);

    const promise = new TelegramApi("123456:TEST_TOKEN").call("getUpdates");
    const rejection = expect(promise).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(45_000);
    await rejection;
  });
});
