# 01 — Decision Log

Every decision below was explicitly made by the project owner on **2026-09-28** during the
planning session. Do not silently change any of them; propose amendments instead.

---

## Environment facts (verified 2026-09-28)

- Dev machine egresses from **Iran** (`loc=IR` per Cloudflare trace, `ip=188.211.72.167`,
  Frankfurt edge colo).
- **Telegram is hard-blocked from the dev machine**: `api.telegram.org`, `telegram.org`,
  `t.me`, `core.telegram.org` all time out.
- `api.cloudflare.com` is reachable (200). `dash.cloudflare.com` and `/sign-up` return 403
  from Iran — the owner has account + dashboard access through other means.
- `github.com` reachable. `workers.dev` root reachable (irrelevant at runtime — users never
  load any web content).
- Tooling present: Node v22.23.2, Bun 1.4.2, Python 3.12.3. Wrangler not yet installed.
  `~/dev/dailypoker.bot` contains only `plan/`; repo initialized 2026-09-28 — branch `main`,
  first commit is the plan, origin `https://github.com/benyamin-git/dailypoker.bot`.
- Telegram Bot API current version: **10.3**. Inline `web_app` buttons are private-chat-only,
  which confirmed dropping the Mini App idea.
- Verified package versions (npm registry):
  | Package | Version | License |
  |---|---|---|
  | `grammy` | 1.46.0 | MIT |
  | `wrangler` | 4.142.0 | MIT OR Apache-2.0 |
  | `@cloudflare/workers-types` | 5.20260928.1 | MIT OR Apache-2.0 |
  | `@cloudflare/vitest-pool-workers` | 0.22.0 | MIT |
  | `zod` | 4.6.5 | MIT |
  | `pokersolver` (dev-only test oracle) | 2.1.4 | MIT |
- Cloudflare free limits (from official docs): Worker 100k requests/day, 10 ms CPU/request,
  128 MB memory, 50 subrequests/request; Durable Objects 100k requests/day, 13,000 GB-s/day,
  **SQLite backend only on free**, 5 GB storage, 5M row reads/day, 100k row writes/day
  (each `setAlarm()` = 1 row write); static assets free/unlimited (not used in v1).

---

## Hosting & operations

| # | Decision | Rationale |
|---|---|---|
| H1 | Owner has a Cloudflare account and dashboard access | Confirmed; dashboard is unreachable from Iran but reachable via other means |
| H2 | Runtime is **100% Cloudflare Workers** (free plan), webhook mode | Home server and Iran network are irrelevant at runtime; CF edge reaches Telegram |
| H3 | One **Durable Object per Telegram group**, SQLite storage backend | Isolation, serialized writes, free-tier friendly, hibernation |
| H4 | **Allowlisted groups only** (`ALLOWED_CHAT_IDS`); unknown groups get **one polite reply, then silence** (second-pass amendment) | Quota protection + privacy + abuse prevention |
| H5 | Manual `wrangler deploy` (no CI/CD) | Owner choice |
| H6 | Dev **and** prod Workers + two separate bots | One bot token = one webhook consumer; dev testing requires a separate bot |
| H7 | Dev workflow: local unit tests → deploy to dev Worker → test in Telegram on phone | Telegram unreachable from dev machine; no VPN wanted |
| H8 | `wrangler` calls `api.cloudflare.com` from Iran (reachable); webhook registration is done **by the Worker itself** via an admin route | `api.telegram.org` is unreachable locally; the Worker can reach it |

## Stack & tooling

| # | Decision | Rationale |
|---|---|---|
| S1 | **TypeScript + grammY 1.46+** | First-class Workers support, maintained, ergonomic keyboards/sessions |
| S2 | Evaluation library: **own compact 7-card evaluator**, validated against `pokersolver` as a dev-only oracle in tests | Lightweight runtime (zero runtime deps for evaluation) + high confidence via oracle |
| S3 | Runtime validation with **zod** at boundaries (update payloads, callback data, env) | Security + correctness |
| S4 | Tests: **vitest** + `@cloudflare/vitest-pool-workers` (DO integration), Bun as package manager/runtime for scripts | Standard Workers testing stack |
| S5 | Worker names (DNS-safe): `dailypokerbot` (prod), `dailypokerbot-dev` (dev) | Worker names cannot contain dots |
| S6 | `compatibility_date`: `2026-09-28`; no `nodejs_compat` unless proven necessary | Lightweight |
| S7 | Send HTML parse mode (escaped) instead of MarkdownV2 | Fewer escaping footguns |

## Game rules & economy

| # | Decision | Details |
|---|---|---|
| G1 | **One hand = one match** | Join → ante → one hand → pot → done |
| G2 | Join eligibility: **balance ≥ 100** | Ensures the cap is always coverable; also blocks broke players until daily |
| G3 | Every player pays a **10-chip ante** ("preblind") at deal | No small/big blind concept exists |
| G4 | **Cap: 100 total contribution per player per match, ante included**; reaching cap = all-in | Max possible loss per match = 100 |
| G5 | Bet amounts are **multiples of 10** | Clean buttons, easy mental math |
| G6 | **Minimum raise matches the previous raise**; initial bet/raise step = 10 | Standard min-raise semantics under the multiples-of-10 constraint |
| G7 | **Action order is re-randomized every hand** | No positional/button state; fairness without blinds |
| G8 | **60-second flat action timer**; auto-check if free, else auto-fold | No time bank |
| G9 | Showdown: **winner shows, others muck** (losers get an optional voluntary `Show` button) | Owner choice |
| G10 | **Secure RNG only** (CSPRNG shuffle); no published deck hash | Owner choice; fairness evidenced by open code + tests |
| G11 | **Full history + stats**: last 1,000 hands per group; lifetime per-player stats | Free-tier SQLite is sufficient |
| G12 | **2–9 players per match; one active match per group** | Telegram button UX + simplicity |
| G13 | Match starts when the **starter taps Deal** after ≥2 joined | No timed auto-deal |

## Economy

| # | Decision | Details |
|---|---|---|
| E1 | **Play chips only** — no real money, no settlement ledger | Legal/ToS safety, open-source safety |
| E2 | `/daily` grants **+200 chips**, once per rolling 24h, **stacks** with balance | Owner choice |
| E3 | `/daily` is claimed **in DM**; a small teaser line is posted in the group | Keeps group clean; social nudge |
| E4 | Bankroll is **per group** (independent economy + leaderboard per group); v1 runs **one allowlisted group per environment**, so DM commands are unambiguous | Isolation |

## UX

| # | Decision | Details |
|---|---|---|
| U1 | Group chat is the table; hole cards + personal stats via DM | Social-first |
| U2 | One pinned message lives Lobby → Table → Result (edited in place) | Clarity; avoids spam |
| U3 | Inline buttons primary; commands (`/fold`, `/raise 40`) as fallback | Buttons are invisible to others; commands are visible banter |
| U4 | Typed command messages **stay visible** in the chat | Social |
| U5 | No turn pings (DMs only send cards + stats replies) | Owner choice |
| U6 | Join onboarding: **auto deep-link flow** — pressing Join without `/start` yields a private alert; a `Start the bot` deep-link button auto-joins them on `/start` | Zero-friction onboarding |
| U7 | Built-in animated effects (Telegram dice/emoji) at dramatic moments (all-in runouts, big pots); no external assets | Fun + open-source safe |
| U8 | Bot admin rights: **pin + delete messages only** | Least privilege; pin for the table message |
| U9 | Winner result is posted as a fresh short group message with `Show my hand` and `Rematch` buttons | Visibility + quick rematch |

## Repo & delivery

| # | Decision | Details |
|---|---|---|
| R1 | GitHub repo name: **exactly `dailypoker.bot`** | Matches project folder |
| R2 | **No LICENSE file** (owner decision) | Open item: repo is source-available, not open source; adding a license later is a one-file change |
| R3 | Manual deploy only; no GitHub Actions | Owner choice |

## Defaults chosen by the planner (veto anytime)

These were not explicitly requested but are needed; they are low-risk and documented as open
to veto:

1. Postflop action order = same randomized order; first remaining player acts.
2. On all-in runouts, **all live hands are revealed** (standard poker; they are all-in).
3. Lobby auto-expires after **15 minutes without a new join**.
4. `/top` is public in the group; `/balance` replies publicly when used in the group and
   privately in DM; `/stats` and `/history` reply in DM.
5. 24h rolling daily cooldown (no timezone/reset-hour logic).
6. Escrow model: antes/bets deduct from balance as they happen; pot credited at hand end.
7. Raise UI is street-level ("raise to N"), multiples of 10, cap-aware helper text.
8. Webhook path contains a random secret segment **plus** the Telegram secret-token header.
9. `setMyCommands` configured for group scope and private scope.
10. Odd remainder chips in split pots go to the earliest players in hand order.
11. Currency named "chips"; symbol amount formatting `1,000`.

## Second-pass review resolutions (2026-09-28)

| # | Topic | Resolution |
|---|---|---|
| 1 | Unknown groups | One polite reply, then silence (amends H4) |
| 2 | Multiple groups | Exactly one allowlisted group per environment; env validation rejects more (clarifies E4) |
| 3 | Starter leaves lobby | `Take over` button + `/takeover`; first remaining player becomes starter (03 §3/§11, 04 §4) |
| 4 | Deploying non-secret vars | Committed placeholders; real values via `wrangler deploy --var KEY:VALUE` (02 runbook, 07 §5) |
| 5 | Timers | Next-deadline scheduler persisted in state; one alarm armed for the earliest of turn/lobby/runout/backoff (02, 05) |
| 6 | Onboarding detection | `players.dm_started` set on `/start` (06 schema, 04 §2) |
| 7 | `/deal` with < 2 players | Edit the lobby message; never delete (04 §6) |
| 8 | Hand numbering | `matches.hand_no` assigned at deal; canceled/expired lobbies do not consume numbers (06) |
| 9 | `callback_data` | Documented schema `m:<matchId>:<turnId>:<action>` (05 §6, 07 T4) |
| 10 | Admin routes | `delete-webhook` replaces `store-webhook`; `set-commands` added for `setMyCommands` (02) |
| 11 | Worked example | `03-game-rules.md §10` pot arithmetic corrected (160/250/310) |

## Implementation amendments (2026-09-28, during M0)

Recorded while implementing M0; each item amends the referenced decision. Veto by reverting.

| # | Topic | Amendment | Reason |
|---|---|---|---|
| A1 | S6 compatibility date | `compatibility_date` is **2026-08-22** (was 2026-09-28) | The locally installed workerd binaries (wrangler 4.143.0 and the one bundled with vitest-pool-workers 0.22.0) reject newer dates; 2026-08-22 is the newest both accept. Production accepts older dates and no v1 feature depends on the exact date. |
| A2 | 06 §6 migrations key | Schema version lives in `meta.schema_version` (string) instead of `PRAGMA user_version` | Workerd Durable Object SQLite returns `SQLITE_AUTH` ("not authorized") for `PRAGMA user_version` — verified by a probe test. All other schema statements are unchanged. |
| A3 | S4 test tooling | `vitest` **4.1.11** with `@cloudflare/vitest-pool-workers` 0.22.0 configured via the `cloudflareTest()` Vite plugin; tests are split into `unit` (Node: pure engine/telegram/util) and `workers` (Miniflare: Worker + DO) Vitest projects | 0.22.0 no longer exports `defineWorkersConfig()` and requires vitest ^4.1.0. |
| A4 | Engine API & constants | Rule constants live in `src/engine/constants.ts` (re-exported by `src/config.ts`); `startHand(state, { rng?, deck?, order? })` takes injected randomness/options; `advanceRunout(state)` and `revealHand(state, userId)` added to the engine API | Keeps `engine/` import-free (M1 acceptance) and lets tests drive ordered seating, known decks and runout steps. |

## Implementation amendments (2026-09-28, during M2–M4)

| # | Topic | Amendment | Reason |
|---|---|---|---|
| A5 | 05 §6 callback schema | `callback_data` is `m:<matchId>:<turnId>:<action>[:<amount>]`; actions are `join`, `leave`, `deal`, `cancel`, `takeover`, `call`, `check`, `fold`, `bet`, `raise`, `raisecustom`, `allin`, `cards`, `show`, `rematch`, `confirmreset` | The extra optional `amount` field carries preset bet/raise sizes, and the M2/M3 UI needs `cards` (DM hole cards) plus `raisecustom` (raise-by-typing menu). Actor/turn/match validation is unchanged. |
| A6 | M4 README | `README.md` carries the full self-host runbook (BotFather, secrets, deploy vars, webhook registration, config reference, manual E2E pointers) | M4 deliverable; keeps `plan/02-hosting.md` as the design source and gives the operator one copy-pasteable entry point. |

## Milestone status (2026-09-29)

Code, tests and docs for M0–M4 are complete and pushed on `main` (commits `85de8dc`, `88991e2`,
`5c57085`, `2a69972`, `a7bf419`). The **dev Worker is deployed and the real bot's webhook is
registered** (2026-09-29; secrets and env vars in place, `setWebhook`/`setMyCommands` verified
via the edge-side helper described in `02-hosting.md`). Outstanding:

- M0/M2/M4 acceptance items that need the real dev bot (`04`–`06` hand flows, `wrangler tail`)
  are unticked in `09-roadmap.md` — the owner still needs to play through them in the group.
- M3 acceptance is fully ticked (see tests named in `test/do/economy.test.ts`).
- Production deploy remains: one bot can only have one webhook, so either create a second
  BotFather bot for prod or re-point the webhook to the prod Worker at launch time.
- Group id, owner id and tokens live only in the gitignored `.dev.vars`/`.env`; they must
  never be committed (repo is public).

## Open items (owner action required before/during M0)

1. **BotFather:** register prod bot and dev bot, choose usernames, set display name
   ("Daily Poker" suggested for prod; e.g. `<BotName> Dev` for dev).
2. **Cloudflare:** confirm worker names, create API token for wrangler (account-scoped,
   Workers Scripts: Edit), set secrets per environment.
3. **Groups:** create/choose dev + prod groups, add bots as admin with pin + delete only,
   collect chat IDs for `ALLOWED_CHAT_IDS`.
4. **Telegram ToS check:** verify current wording re: gambling before public launch (play
   chips only, so expected fine).
5. **LICENSE:** revisit when the repo goes public (see R2).
