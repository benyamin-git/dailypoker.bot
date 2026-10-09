import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob("../../src/telegram/messages/{en,fa}.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const PICTORAPHS = /\p{Extended_Pictographic}/u;

describe("message catalogues", () => {
  it("contain no emoji or pictographic symbols", () => {
    const entries = Object.entries(SOURCES);
    expect(entries).toHaveLength(2);
    for (const [path, source] of entries) {
      const matches = source.match(PICTORAPHS) ?? [];
      expect(matches, path).toEqual([]);
    }
  });
});
