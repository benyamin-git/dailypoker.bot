# 08 — Repo & Tooling

---

## 1. Repository

- **GitHub repo name:** `dailypoker.bot` (exact, includes the dot).
- Repo initialized 2026-09-28 with a fresh `git init`; history starts with the `plan/` commit
  (no secrets ever committed). M0 adds the scaffold on top of it.
- Remote: `origin` → `https://github.com/benyamin-git/dailypoker.bot`.
- **No LICENSE** (owner decision R2). README states this explicitly: source-available, not
  open source; adding a license later is a one-file change.
- Default branch: `main`. Commit style: short imperative subject lines; no tooling enforced.

## 2. Folder structure

```
dailypoker.bot/
├── plan/                     # this folder — source of truth
├── src/
│   ├── index.ts              # Worker entry: webhook router + admin routes
│   ├── env.ts                # bindings type + zod validation
│   ├── config.ts             # game constants
│   ├── telegram/
│   │   ├── bot.ts            # grammY assembly + intent classification
│   │   ├── api.ts            # send/edit/answer helpers, throttle, 429 retry
│   │   ├── messages.ts       # HTML builders (escaping)
│   │   └── keyboards.ts      # inline keyboards
│   ├── engine/
│   │   ├── types.ts
│   │   ├── deck.ts           # CSPRNG shuffle, seeded RNG for tests, deal()
│   │   ├── evaluator.ts      # 7-card evaluator
│   │   ├── hand.ts           # betting state machine (pure)
│   │   └── pots.ts           # dead money + splits
│   ├── game/
│   │   ├── table-do.ts       # Durable Object
│   │   ├── store.ts          # SQLite schema/queries/migrations
│   │   └── stats.ts
│   └── util/
│       ├── rate-limit.ts
│       └── time.ts
├── test/
│   ├── engine/               # deck, evaluator (+oracle), hand, pots, conformance
│   ├── telegram/             # messages/keyboards/escaping, callback validation
│   ├── do/                   # vitest-pool-workers integration
│   └── fixtures/             # known hands, seeds, sample updates
├── wrangler.jsonc
├── vitest.config.ts
├── biome.json
├── tsconfig.json
├── package.json
├── bun.lock
├── .gitignore
├── .dev.vars.example
└── README.md
```

## 3. Tooling

| Tool | Role | Notes |
|---|---|---|
| Bun 1.4.x | package manager + script runner | `bun install`, `bun run …`; lockfile `bun.lock` committed |
| TypeScript 5.x (strict) | language | `strict`, `noUncheckedIndexedAccess`; `tsc --noEmit` for typecheck |
| wrangler 4.142+ | deploy/dev | `wrangler dev --env dev`, `wrangler deploy --env …` |
| grammY 1.46+ | Telegram framework | Only runtime deps: `grammy`, `zod` |
| zod 4.6+ | boundary validation | Note: zod < 4.5 has Workers memory issues — keep ≥ 4.6 |
| vitest + @cloudflare/vitest-pool-workers | tests | Unit + DO integration |
| pokersolver (devDependency) | evaluator test oracle | Never bundled |
| Biome | lint + format | Single fast tool instead of eslint+prettier |

## 4. package.json scripts

```json
{
  "scripts": {
    "dev": "wrangler dev --env dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:heavy": "TEST_HEAVY=1 vitest run test/engine/evaluator.oracle.test.ts",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "format": "biome format --write .",
    "deploy:dev": "wrangler deploy --env dev",
    "deploy:prod": "wrangler deploy --env production",
    "cf-typegen": "wrangler types"
  }
}
```

## 5. wrangler.jsonc (shape, not final)

```jsonc
{
  "name": "dailypokerbot",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-22",
  "durable_objects": {
    "bindings": [{ "name": "TABLE", "class_name": "TableDO" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["TableDO"] }],
  "vars": { "EFFECTS_ENABLED": "true" },
  "env": {
    "dev":        { "name": "dailypokerbot-dev", "vars": { "ALLOWED_CHAT_IDS": "-1001234567890", "OWNER_USER_ID": "123456789", "BOT_USERNAME": "dailypoker_dev_bot", "WEBHOOK_PATH": "replace-with-random-hex" } },
    "production": { "name": "dailypokerbot",     "vars": { "ALLOWED_CHAT_IDS": "-1000000000000", "OWNER_USER_ID": "123456789", "BOT_USERNAME": "dailypoker_bot",     "WEBHOOK_PATH": "replace-with-random-hex" } }
  }
}
```

Real values are placeholders in the repo; the owner passes them at deploy time with
`wrangler deploy --var KEY:VALUE` (non-secret config) and `wrangler secret` (tokens).
Local dev reads `.dev.vars` (gitignored).

## 6. .gitignore / .dev.vars.example

**.gitignore**

```
node_modules/
.wrangler/
.dev.vars
.env
.env.*
dist/
*.log
coverage/
.DS_Store
```

**`.dev.vars.example`**

```
BOT_TOKEN=123456:REPLACE_ME
WEBHOOK_SECRET=replace-with-random-hex
ADMIN_KEY=replace-with-random-value
ALLOWED_CHAT_IDS=-1001234567890
OWNER_USER_ID=123456789
BOT_USERNAME=your_dev_bot
WEBHOOK_PATH=replace-with-random-hex
EFFECTS_ENABLED=true
```

## 7. Testing strategy

### Engine unit tests (the majority; no Workers needed)

| Suite | Covers |
|---|---|
| `deck.test.ts` | Seeded shuffle determinism, card uniqueness, deal sizes |
| `evaluator.oracle.test.ts` | Hand-crafted comparisons + randomized conformance vs pokersolver (heavy corpus behind `TEST_HEAVY=1`) |
| `hand.test.ts` | Betting legality matrix: min raise matching previous increment, multiples of 10, cap/all-in, short all-in not reopening action, check/call/fold, streets, all-in runout reveal, fold-out endings |
| `pots.test.ts` | Dead money, single pot math, splits + remainder ordering, worked example from `03-game-rules.md §10` |
| `conformance.test.ts` | Every edge case row in `03-game-rules.md §11` maps to at least one test name |

### DO integration tests (vitest-pool-workers)

- Mocked Telegram `fetch` (assert exact method + payloads, capture message ids).
- Full hand drive: `/newmatch` → joins → deal → actions → showdown with fake clock.
- Alarm test: `runDurableObjectAlarm` → auto-check/auto-fold applied.
- Scheduler test: concurrent deadlines (turn + lobby expiry + runout steps) all fire in order.
- Dedupe test: same `update_id` twice → one effect.
- Security tests from `07-security.md §9`.

### Manual E2E checklist (dev bot, phone)

- [ ] Onboarding deep-link join flow with a fresh account that never `/start`ed.
- [ ] 2-player and 9-player hands; buttons + commands both paths.
- [ ] Timeout auto-action; stale-tap alerts; rapid button mashing.
- [ ] Daily claim, cooldown message, group teaser.
- [ ] All-in runout effects; reveal-all; split pot with dead money.
- [ ] Pinned message behavior after 20+ messages of chat noise.

## 8. README outline (public)

1. What it is + one mock of the play-by-play messages.
2. The ruleset (summary table + link to `plan/03-game-rules.md`).
3. Quick start for self-hosters: BotFather bot, Cloudflare account, secrets, deploy,
   webhook registration, allowlist, group admin rights.
4. Commands reference.
5. Development: tests, dev worker, dev bot.
6. Architecture overview (one diagram).
7. Security notes + no-license statement + disclaimer (play chips only).
