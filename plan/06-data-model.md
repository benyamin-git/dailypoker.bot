# 06 — Data Model

All persistence lives in **one Durable Object SQLite database per Telegram group**
(`ctx.storage.sql`). There is no D1, no KV, no R2 in v1. All timestamps are Unix milliseconds
(integers).

---

## 1. Schema

```sql
PRAGMA user_version = 1;  -- migrations key

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  user_id        INTEGER PRIMARY KEY,
  username       TEXT,                 -- refreshed on contact, nullable
  first_name     TEXT NOT NULL,
  balance        INTEGER NOT NULL,     -- chips, per group
  last_daily_at  INTEGER,              -- epoch ms, null = never claimed
  hands_played   INTEGER NOT NULL DEFAULT 0,
  hands_won      INTEGER NOT NULL DEFAULT 0,
  chips_won      INTEGER NOT NULL DEFAULT 0,
  chips_lost     INTEGER NOT NULL DEFAULT 0,
  biggest_pot    INTEGER NOT NULL DEFAULT 0,
  best_hand      TEXT,                 -- e.g. "Full house, Aces over Kings"
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,  -- hand number, per group
  status      TEXT NOT NULL,          -- lobby | active | done | canceled | expired
  starter_id  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  started_at  INTEGER,
  ended_at    INTEGER,
  pot         INTEGER,
  board       TEXT,                   -- JSON array of cards, e.g. ["As","Kd","7c"]
  winner_ids  TEXT,                   -- JSON array of user ids
  log         TEXT                    -- JSON: ordered actions + hole cards (see §3)
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id     INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  seat_order   INTEGER NOT NULL,      -- position in this hand's shuffled order
  contribution INTEGER NOT NULL DEFAULT 0,
  folded       INTEGER NOT NULL DEFAULT 0,
  all_in       INTEGER NOT NULL DEFAULT 0,
  shown        INTEGER NOT NULL DEFAULT 0,
  hole         TEXT,                  -- JSON array of 2 cards, null while hidden
  delta        INTEGER NOT NULL DEFAULT 0,  -- net chips for this match
  PRIMARY KEY (match_id, user_id)
);

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_players_balance ON players (balance DESC);
CREATE INDEX IF NOT EXISTS idx_matches_created ON matches (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_user          ON match_players (user_id);
```

## 2. Invariants

- `players.balance >= 0` always. Escrow deducts as actions happen; max loss per match is 100
  and join requires ≥ 100.
- One `matches` row with `status IN ('lobby','active')` at most, per group.
- `match_players.contribution <= 100`; `contribution` is the sum of escorted chips.
- `hand_no` = `matches.id` (autoincrement), shown to players as "Hand #N".

## 3. Hand log format (JSON in `matches.log`)

```json
{
  "order": [111, 222, 333],
  "hole": { "111": ["As","Kd"], "222": ["7c","7d"] },
  "streets": [
    { "name": "preflop", "board": [] },
    { "name": "flop",    "board": ["Ah","9s","2c"] }
  ],
  "actions": [
    { "t": 1790000000123, "user": 333, "street": 0, "kind": "bet",   "to": 20 },
    { "t": 1790000000456, "user": 111, "street": 0, "kind": "call",  "to": 20 },
    { "t": 1790000000789, "user": 222, "street": 0, "kind": "fold" },
    { "t": 1790000000999, "user": 333, "street": 1, "kind": "check" }
  ],
  "result": { "winners": [111], "pot": 170, "deltas": { "111": 140, "222": -10, "333": -30 } }
}
```

Purpose: `/history`, stats recomputation if ever needed, and debugging. Hole cards are stored
only after the hand ends; `match_players.hole` is populated at completion (or at showdown for
revealed hands). Nothing in the log is ever exposed outside the group's own chat.

## 4. Stats maintenance

Updated transactionally at hand end (same DO request):

- `hands_played += 1` for all participants.
- `hands_won += 1`, `biggest_pot = max(...)` for winners.
- `chips_won += won`, `chips_lost += lost`.
- `best_hand` updated if the player's shown hand beats the stored category ordering.
- `balance += delta`.

Leaderboard (`/top`) = `SELECT ... ORDER BY balance DESC LIMIT 5`.
Personal record (`/balance`, `/stats`) comes from `players` + current match context.

## 5. Retention & pruning

| Data | Retention | Mechanism |
|---|---|---|
| `matches` + `match_players` | Newest **1,000 hands** per group | After insert, `DELETE FROM matches WHERE id <= (SELECT MAX(id) - 1000)`; `match_players` cascaded manually in the same statement batch |
| `processed_updates` | 7 days | Lazy prune when count exceeds 5,000 (1 delete statement) |
| `players` | Forever | Needed for bankroll/leaderboard |

Storage estimate: ~3–6 KB per hand log → ≤ 6 MB per group at full retention; hundreds of
groups fit in the 5 GB free allowance.

## 6. Migrations

- `PRAGMA user_version` gates numbered migration arrays in `store.ts`.
- Migrations run inside `ctx.blockConcurrencyWhile` on first DO wake.
- v1 ships with schema version 1 (above). Additive changes only; destructive changes require
  an owner-run `/resetgroup` (with explicit confirmation).

## 7. Backup & export

Not in v1. Backlog: owner-only `/exportgroup <chat_id>` producing a JSON dump (hand history +
balances) to DM or R2.
