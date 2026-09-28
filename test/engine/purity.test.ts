/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

const ENGINE_SOURCES = import.meta.glob("../../src/engine/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("engine purity", () => {
  it("only imports modules inside engine/", () => {
    const violations: string[] = [];
    for (const [path, source] of Object.entries(ENGINE_SOURCES)) {
      const sourceUrl = new URL(path, import.meta.url);
      for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
        const specifier = match[1] as string;
        if (!specifier.startsWith(".")) {
          violations.push(`${path} imports external module "${specifier}"`);
          continue;
        }
        const resolved = new URL(specifier, sourceUrl).pathname;
        if (!resolved.includes("/src/engine/")) {
          violations.push(`${path} imports outside engine/: "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
