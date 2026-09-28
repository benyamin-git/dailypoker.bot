import { describe, expect, it } from "vitest";

import { constantTimeEqual } from "../../src/util/crypto";

describe("constantTimeEqual", () => {
  it("accepts identical strings", () => {
    expect(constantTimeEqual("secret-token", "secret-token")).toBe(true);
  });

  it("rejects different strings of equal length", () => {
    expect(constantTimeEqual("secret-token", "secret-toker")).toBe(false);
    expect(constantTimeEqual("aaaa", "aaab")).toBe(false);
  });

  it("rejects strings of differing lengths", () => {
    expect(constantTimeEqual("short", "longer-secret")).toBe(false);
    expect(constantTimeEqual("longer-secret", "short")).toBe(false);
  });

  it("handles empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("", "x")).toBe(false);
  });

  it("compares unicode by UTF-8 bytes", () => {
    expect(constantTimeEqual("hëllo", "hëllo")).toBe(true);
    expect(constantTimeEqual("hëllo", "hello")).toBe(false);
  });
});
