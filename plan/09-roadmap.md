# 09 — Roadmap

Each milestone ends with acceptance criteria that must pass before moving on.
Implementation starts only after the owner approves this plan.

---

## M0 — Scaffold & webhook liveness

**Tasks**

- Folder structure, package.json, tsconfig, biome, vitest config, wrangler.jsonc (repo and
  `main` branch already initialized 2026-09-28).
- Worker skeleton: env validation (zod), webhook router with secret header check +
  constant-time compare, admin routes (`register-webhook`, `webhook-info`, `delete-webhook`).
- `TableDO` skeleton with migrations scaffold and `update_id` dedupe.
- Minimal grammY reply: `/ping` → `🏓 pong (dev)`; allowlist check for unknown groups.
- Owner actions: create dev bot + dev group, set secrets, deploy dev, register webhook.

**Acceptance**

- [ ] `/ping` in the dev group replies within 2s.
- [ ] POST without secret header → 403; wrong path → 404; duplicate `update_id` → single pong.
- [ ] Unknown group gets one polite reply, nothing else.
- [ ] `wrangler tail` and `webhook-info` usable from the dev machine (or via dashboard).

## M1 — Pure engine + proof tests

**Tasks**

- `engine/types.ts`, `deck.ts` (CSPRNG + seeded RNG), `evaluator.ts`, `hand.ts`, `pots.ts`.
- Full test suites per `08-repo-tooling.md §7`, including the pokersolver oracle and every
  edge case in `03-game-rules.md §11`.
- Worked example (§10 of rules) encoded as a test.

**Acceptance**

- [ ] `bun run test` + `bun run typecheck` + `bun run lint` all green.
- [ ] `TEST_HEAVY=1` oracle run green (≥ 1,000,000 randomized 7-card comparisons).
- [ ] Betting legality matrix has explicit tests for: min-raise matching previous increment,
  multiples of 10, cap/all-in, short all-in non-reopening, split remainders.
- [ ] Engine has zero imports outside `engine/` (checked by a test or lint rule).

## M2 — Gameplay on the dev bot

**Tasks**

- Lobby → table message editing, keyboards, callback + command handling, deep-link
  onboarding, DM cards, result message + rematch, dice effects.
- Timer alarms (60s, auto check/fold), outgoing throttle + 429 handling, stale button alerts.
- Persistence of match state per action in SQLite.

**Acceptance**

- [ ] Full hand between 2 real accounts in the dev group, start to finish, all via buttons.
- [ ] A 9-player stress hand completes; no duplicate/ghost actions.
- [ ] Timeout fires correctly; stale taps and non-actor taps only produce private alerts.
- [ ] All-in runout reveals all hands and effects play (flag-gated).
- [ ] Worker CPU stays comfortably under 10 ms (checked via dashboard metrics).

## M3 — Economy & stats

**Tasks**

- `/daily` (DM + group teaser), balance escrow integration, bankruptcy handling (auto
  ineligibility until claim), `/balance`, `/stats`, `/top`, `/history`.
- Hand log + stats persistence + pruning (1,000 hands), owner `/resetgroup`.

**Acceptance**

- [ ] Daily cooldown verified with fake clock; balances never negative.
- [ ] Leaderboard and history match a hand-computed corpus of 50 scripted hands.
- [ ] Pruning keeps exactly the newest 1,000 matches; storage stays bounded.

## M4 — Polish & first production deploy

**Tasks**

- Help/rules texts, error UX pass, command scopes (`setMyCommands`), README, security
  checklist per `07-security.md §5`, manual E2E checklist.
- Prod worker + prod bot, secrets, prod group allowlist, webhook, admin rights (pin+delete).

**Acceptance**

- [ ] All manual E2E checklist items pass on the dev bot.
- [ ] Security checklist signed off (repo scan, header tests, allowlist tests).
- [ ] First live hand played in the real group; zero errors in `wrangler tail`.
- [ ] `v0.1.0` tag on GitHub (no LICENSE — see `01-decisions.md` R2).

---

## Post-v1 backlog (not committed)

- Optional deck-hash commit-reveal for provable fairness.
- Turn pings toggle (`/settings`) using Telegram DM.
- Multi-hand sessions / SNG + cash-game formats.
- Omaha and other variants.
- i18n (Persian) with per-group switch.
- Owner `/exportgroup` JSON export.
- GitHub Actions CI (tests) if the owner changes their mind.
- Custom sticker IDs via config for self-hosters.
- `chat_member` handling for players leaving mid-hand (instant fold instead of waiting 60s).

## Open items (owner)

- [ ] BotFather: register dev + prod bots; choose usernames; display name "Daily Poker".
- [ ] Cloudflare: create dev + prod workers; `wrangler` API token; secrets per env.
- [ ] Groups: dev + prod groups; bot admin with pin + delete only; collect chat ids.
- [ ] Telegram ToS gambling wording check before public launch; record in `07-security.md §7`.
- [ ] Decide on LICENSE when the repo goes public (currently none).
