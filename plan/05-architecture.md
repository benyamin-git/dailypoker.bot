# 05 — Architecture

---

## 1. Module layout

```
src/
├── index.ts            Worker entry: webhook router, admin routes, env checks
├── env.ts              Env bindings type + zod runtime validation
├── config.ts           Game constants (see 03-game-rules.md §12)
├── telegram/
│   ├── bot.ts          grammY assembly; update → intent (command/callback/text)
│   ├── api.ts          Telegram API wrapper: send/edit/answerCallback, throttling, 429 retry
│   ├── messages.ts     HTML text builders (escaping, card formatting)
│   └── keyboards.ts    Inline keyboard builders per state
├── engine/
│   ├── types.ts        Pure domain types (MatchState, Player, Action, Event)
│   ├── deck.ts         CSPRNG shuffle + seeded PRNG (tests) + deal()
│   ├── evaluator.ts    7-card evaluator → comparable score
│   ├── hand.ts         Betting state machine (pure)
│   └── pots.ts         Single-pot math: dead money, splits, remainders
├── game/
│   ├── table-do.ts     Durable Object: orchestration, alarms, persistence hooks
│   ├── store.ts        SQLite schema, queries, migrations
│   └── stats.ts        Derived stats updates + queries
└── util/
    ├── rate-limit.ts   Per-user command throttle, outgoing send queue
    └── time.ts         Clock injection (fake time in tests)
```

Principle: `engine/` imports nothing outside `engine/`. No `fetch`, no storage, no clock, no
randomness except an injected source. Everything else depends on it, never the reverse.

## 2. Engine API (pure)

```ts
type Action =
  | { kind: 'fold' } | { kind: 'check' } | { kind: 'call' }
  | { kind: 'bet'; to: number }      // street-level total
  | { kind: 'raise'; to: number }    // street-level total
  | { kind: 'allin' };

createMatch(input: { chatId: number; matchId: number; players: PlayerSeed[]; rng: Rng }): MatchState
startHand(state: MatchState): { state: MatchState; events: Event[] }   // shuffle, order, deal, antes
legalActions(state: MatchState, userId: number): Action[]
applyAction(state: MatchState, userId: number, action: Action): { state: MatchState; events: Event[] }
timeoutAction(state: MatchState): { state: MatchState; events: Event[] }  // check-or-fold
```

- `Rng` is `() => number` (uniform apart from a documented 2^-32 bias tolerance); production
  implementation uses `crypto.getRandomValues`; tests use a seeded PRNG or fixed sequences.
- `Event` is a serializable description (`CardsDealt`, `ActionTaken`, `StreetAdvanced`,
  `HandComplete`, `PotAwarded`, `Showdown`) — the Telegram layer maps events to messages.
  The engine never touches Telegram.
- `MatchState` is a plain JSON-serializable object; the DO persists a snapshot per action.

## 3. Evaluator strategy

- Single 7-card evaluator returning an ordered 32-bit score (category + kickers), enough to
  rank any 7-card hand and compare exactly.
- **Oracle testing**: `pokersolver` (MIT) is a devDependency and never bundled. Tests:
  1. Hand-crafted tricky comparisons (wheel, counterfeited two-pair, kicker wars, board
     plays).
  2. Randomized conformance: millions of random 7-card hands compared to the oracle
     (batched, seeded runs; a smaller corpus in the default `bun test`, exhaustive corpus
     behind `TEST_HEAVY=1`).
- Any mismatch fails CI-equivalent local runs; the evaluator is rewritten until clean.

## 4. Durable Object (`TableDO`)

One DO instance per group (`idFromName(String(chatId))`).

Responsibilities:

| Concern | Design |
|---|---|
| Update dedupe | `processed_updates(update_id)` insert-first; skip if exists |
| Match lifecycle | Lobby state in memory + snapshot persisted; engine drives hand |
| Timers | Next-deadline scheduler: all pending deadlines (turn, lobby TTL, runout steps, backoff) persisted in state; single alarm armed for the earliest |
| Outgoing calls | All Telegram sends go through `telegram/api.ts` throttling/queue |
| Persistence | SQLite via `ctx.storage.sql`; snapshot + bankroll/stats updates per action |
| Migrations | `PRAGMA user_version`; versioned statements run in `blockConcurrencyWhile` on first wake |
| Hibernation | Between actions the DO may hibernate; alarm wakes it; state reloads from SQLite |
| Rate limits | Per-user command throttle (e.g. 1 action/sec), outgoing queue caps |

Concurrency is free: DOs process requests single-threaded per object, so the hand state
machine never races. All writes are synchronous within a request (SQLite `exec`), so the
`update_id` dedupe + state write are atomic enough for at-least-once webhook delivery.

## 5. Request paths

**Incoming update (command or callback)**

```
Telegram → Worker /tg/<path>
  verify header (constant-time) → parse chat_id → stub.fetch(raw)
DO:
  1. dedupe update_id
  2. is group allowlisted / bot still member?
  3. classify intent (grammY inside DO or hand-rolled switch)
  4. validate actor + action via legalActions()
  5. persist snapshot + stats
  6. emit telegram sends (edit table, DM cards, dice, result)
  7. re-arm the next-deadline alarm
Worker ← DO ack → 200 to Telegram
```

**Alarm (next deadline)**

```
DO alarm fires → apply every due deadline (timeoutAction / lobby expiry / runout step /
backoff retry) → persist → emit sends → re-arm for the next deadline (if any)
```

**Admin routes** (`/tg/<path>/admin/*`) are handled in the Worker, guarded by `x-admin-key`,
and proxy Telegram webhook management calls (never exposed to groups).

## 6. Telegram layer details

- **grammY** is used for update typing, context helpers and `setMyCommands`; routing between
  Worker and DO is hand-rolled (the DO receives the raw update JSON).
- `telegram/api.ts` owns: HTML escaping, 429 handling (`retry_after`), edit coalescing
  (min 1s between edits of the same message; coalesce queued edits), and a hard cap on
  sends per update.
- Message IDs and the pinned table message id are stored in match state.
- `setMyCommands` scopes: `all_group_chats` (group commands) and `all_private_chats` (DM
  commands). Run once via an admin route during M0.
- HTML mode; every interpolated name passes through `escapeHtml()`.
- `callback_data` schema (≤ 64 bytes): `m:<matchId>:<turnId>:<action>`, where `action` ∈
  `join|leave|deal|cancel|takeover|fold|check|call|raise|allin|show|rematch`. Every callback
  is validated against the current match, turn and actor; stale data → private alert.

## 7. Failure handling

| Failure | Behavior |
|---|---|
| Telegram API 429 | Wait `retry_after` (cap ~30s), retry once, then drop the send (state already persisted; the next action re-edits the table message) |
| Telegram API 4xx (bad request) | Log redacted, don't retry; alert the owner at most once per hour |
| DO SQLite error | Surface 500 to the Worker → Telegram retries; dedupe makes it idempotent |
| Alarm lost/late | On any next wake, compare deadline vs now; if past, apply the timeout action immediately |
| Bot removed from group | `my_chat_member` marks group inactive; all further updates for that chat are ignored until re-added |
| Unknown/unsupported update | Acknowledged with 200 and ignored (no logs for noise like edited messages) |

## 8. Lightweight footprint

- Runtime dependencies: `grammy`, `zod` only (evaluator is ours; pokersolver is dev-only).
- Estimated bundle: well under 1 MiB — far below the 64 MiB limit; startup ≪ 1s.
- CPU per update: microseconds to low milliseconds (validate + state machine + a couple of
  `JSON.parse`/`stringify`); comfortably inside the 10 ms free limit. Verified in M2 with a
  9-player stress test and editor tooling if needed.
