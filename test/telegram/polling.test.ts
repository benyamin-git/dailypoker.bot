import { describe, expect, it, vi } from "vitest";

import { pollOnce } from "../../src/polling";
import { messageUpdate } from "../table/helpers";

describe("pollOnce", () => {
  it("passes the offset, handles valid updates in order and returns the next offset", async () => {
    const fetchUpdates = vi.fn(async () => [
      messageUpdate(41, -1001, 7, "/ping"),
      { update_id: "42", edited_message: { not: "supported" } },
      messageUpdate(43, -1001, 7, "/help"),
    ]);
    const handled: number[] = [];

    const next = await pollOnce(
      fetchUpdates,
      async (update) => {
        handled.push(update.update_id);
      },
      40,
    );

    expect(fetchUpdates).toHaveBeenCalledWith(40);
    expect(handled).toEqual([41, 43]);
    expect(next).toBe(44);
  });

  it("keeps the offset when a batch is empty", async () => {
    const next = await pollOnce(
      async () => [],
      async () => {
        throw new Error("should not handle");
      },
      99,
    );
    expect(next).toBe(99);
  });
});
