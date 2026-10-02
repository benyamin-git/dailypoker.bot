import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export const TEST_BINDINGS = {
  BOT_TOKEN: "123456:TEST_TOKEN",
  WEBHOOK_SECRET: "test-webhook-secret-0000",
  ADMIN_KEY: "test-admin-key-00000000",
  ALLOWED_CHAT_IDS: "-1009999999999",
  OWNER_USER_ID: "424242",
  BOT_USERNAME: "dailypoker_test_bot",
  WEBHOOK_PATH: "test-webhook-path",
  EFFECTS_ENABLED: "true",
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: [
            "test/engine/**/*.test.ts",
            "test/telegram/**/*.test.ts",
            "test/util/**/*.test.ts",
          ],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: TEST_BINDINGS },
          }),
        ],
        test: {
          name: "workers",
          include: ["test/do/**/*.test.ts"],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: { ...TEST_BINDINGS, EFFECTS_ENABLED: "false" } },
          }),
        ],
        test: {
          name: "workers-noeffects",
          include: ["test/noeffects/**/*.test.ts"],
        },
      },
    ],
  },
});
