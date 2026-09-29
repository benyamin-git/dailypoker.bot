import { HISTORY_LIMIT, PRUNE_UPDATES_AFTER_MS, PRUNE_UPDATES_THRESHOLD } from "../config";
import type { Card, PlayerState } from "../engine/types";

const MIGRATIONS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE IF NOT EXISTS meta (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS players (
       user_id        INTEGER PRIMARY KEY,
       username       TEXT,
       first_name     TEXT NOT NULL,
       balance        INTEGER NOT NULL,
       last_daily_at  INTEGER,
       dm_started     INTEGER NOT NULL DEFAULT 0,
       hands_played   INTEGER NOT NULL DEFAULT 0,
       hands_won      INTEGER NOT NULL DEFAULT 0,
       chips_won      INTEGER NOT NULL DEFAULT 0,
       chips_lost     INTEGER NOT NULL DEFAULT 0,
       biggest_pot    INTEGER NOT NULL DEFAULT 0,
       best_hand      TEXT,
       created_at     INTEGER NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS matches (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       hand_no     INTEGER,
       status      TEXT NOT NULL,
       starter_id  INTEGER NOT NULL,
       created_at  INTEGER NOT NULL,
       started_at  INTEGER,
       ended_at    INTEGER,
       pot         INTEGER,
       board       TEXT,
       winner_ids  TEXT,
       log         TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS match_players (
       match_id     INTEGER NOT NULL,
       user_id      INTEGER NOT NULL,
       seat_order   INTEGER NOT NULL,
       contribution INTEGER NOT NULL DEFAULT 0,
       folded       INTEGER NOT NULL DEFAULT 0,
       all_in       INTEGER NOT NULL DEFAULT 0,
       shown        INTEGER NOT NULL DEFAULT 0,
       hole         TEXT,
       delta        INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (match_id, user_id)
     )`,
    `CREATE TABLE IF NOT EXISTS processed_updates (
       update_id INTEGER PRIMARY KEY,
       at        INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_players_balance ON players (balance DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_matches_created ON matches (created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_mp_user ON match_players (user_id)`,
  ],
];

export function runMigrations(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const rows = sql.exec("SELECT value FROM meta WHERE key = 'schema_version'").toArray() as {
    value: string;
  }[];
  let version = rows[0] === undefined ? 0 : Number(rows[0].value);
  while (version < MIGRATIONS.length) {
    const statements = MIGRATIONS[version] as readonly string[];
    for (const statement of statements) {
      sql.exec(statement);
    }
    version++;
    setMeta(sql, "schema_version", String(version));
  }
}

export function getMeta(sql: SqlStorage, key: string): string | null {
  const rows = sql.exec("SELECT value FROM meta WHERE key = ?", key).toArray() as {
    value: string;
  }[];
  return rows[0]?.value ?? null;
}

export function setMeta(sql: SqlStorage, key: string, value: string): void {
  sql.exec(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

export function deleteMeta(sql: SqlStorage, key: string): void {
  sql.exec("DELETE FROM meta WHERE key = ?", key);
}

export type GroupLang = "en" | "fa";

export function getLang(sql: SqlStorage): GroupLang {
  return getMeta(sql, "group_lang") === "fa" ? "fa" : "en";
}

export function setLang(sql: SqlStorage, lang: GroupLang): void {
  setMeta(sql, "group_lang", lang);
}

export function isUpdateProcessed(sql: SqlStorage, updateId: number): boolean {
  const rows = sql
    .exec("SELECT 1 AS present FROM processed_updates WHERE update_id = ?", updateId)
    .toArray();
  return rows.length > 0;
}

export function markUpdateProcessed(sql: SqlStorage, updateId: number, now: number): void {
  sql.exec("INSERT OR IGNORE INTO processed_updates (update_id, at) VALUES (?, ?)", updateId, now);
}

export function maybePruneUpdates(sql: SqlStorage, now: number): void {
  const row = sql.exec("SELECT COUNT(*) AS count FROM processed_updates").one() as {
    count: number;
  };
  if (row.count > PRUNE_UPDATES_THRESHOLD) {
    sql.exec("DELETE FROM processed_updates WHERE at < ?", now - PRUNE_UPDATES_AFTER_MS);
  }
}

export interface PlayerRow {
  user_id: number;
  username: string | null;
  first_name: string;
  balance: number;
  last_daily_at: number | null;
  dm_started: number;
  hands_played: number;
  hands_won: number;
  chips_won: number;
  chips_lost: number;
  biggest_pot: number;
  best_hand: string | null;
  created_at: number;
}

export function getPlayer(sql: SqlStorage, userId: number): PlayerRow | null {
  const rows = sql
    .exec("SELECT * FROM players WHERE user_id = ?", userId)
    .toArray() as unknown as PlayerRow[];
  return rows[0] ?? null;
}

export function ensurePlayer(
  sql: SqlStorage,
  user: { id: number; firstName: string; username: string | null },
  now: number,
): PlayerRow {
  const existing = getPlayer(sql, user.id);
  if (existing) {
    if (existing.first_name !== user.firstName || existing.username !== user.username) {
      sql.exec(
        "UPDATE players SET first_name = ?, username = ? WHERE user_id = ?",
        user.firstName,
        user.username,
        user.id,
      );
      existing.first_name = user.firstName;
      existing.username = user.username;
    }
    return existing;
  }
  sql.exec(
    `INSERT INTO players (user_id, username, first_name, balance, created_at)
     VALUES (?, ?, ?, 0, ?)`,
    user.id,
    user.username,
    user.firstName,
    now,
  );
  return {
    user_id: user.id,
    username: user.username,
    first_name: user.firstName,
    balance: 0,
    last_daily_at: null,
    dm_started: 0,
    hands_played: 0,
    hands_won: 0,
    chips_won: 0,
    chips_lost: 0,
    biggest_pot: 0,
    best_hand: null,
    created_at: now,
  };
}

export function setDmStarted(sql: SqlStorage, userId: number): void {
  sql.exec("UPDATE players SET dm_started = 1 WHERE user_id = ?", userId);
}

export function adjustBalance(sql: SqlStorage, userId: number, delta: number): void {
  if (delta === 0) {
    return;
  }
  sql.exec("UPDATE players SET balance = balance + ? WHERE user_id = ?", delta, userId);
}

export function createMatchRow(sql: SqlStorage, starterId: number, now: number): number {
  sql.exec(
    `INSERT INTO matches (hand_no, status, starter_id, created_at)
     VALUES (NULL, 'lobby', ?, ?)`,
    starterId,
    now,
  );
  const row = sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number };
  return row.id;
}

export function nextHandNo(sql: SqlStorage): number {
  const row = sql.exec("SELECT COALESCE(MAX(hand_no), 0) + 1 AS next FROM matches").one() as {
    next: number;
  };
  return row.next;
}

export function setMatchStatus(
  sql: SqlStorage,
  matchId: number,
  status: string,
  endedAt: number | null = null,
): void {
  if (endedAt === null) {
    sql.exec("UPDATE matches SET status = ? WHERE id = ?", status, matchId);
  } else {
    sql.exec("UPDATE matches SET status = ?, ended_at = ? WHERE id = ?", status, endedAt, matchId);
  }
}

export function setMatchStarted(
  sql: SqlStorage,
  matchId: number,
  handNo: number,
  startedAt: number,
): void {
  sql.exec(
    "UPDATE matches SET status = 'active', hand_no = ?, started_at = ? WHERE id = ?",
    handNo,
    startedAt,
    matchId,
  );
}

export function deleteMatch(sql: SqlStorage, matchId: number): void {
  sql.exec("DELETE FROM match_players WHERE match_id = ?", matchId);
  sql.exec("DELETE FROM matches WHERE id = ?", matchId);
}

export interface MatchPlayerWrite {
  userId: number;
  seatOrder: number;
  contribution: number;
  folded: boolean;
  allIn: boolean;
  shown: boolean;
  hole: [Card, Card] | null;
  delta: number;
}

export function upsertMatchPlayers(
  sql: SqlStorage,
  matchId: number,
  players: MatchPlayerWrite[],
): void {
  for (const player of players) {
    sql.exec(
      `INSERT INTO match_players
         (match_id, user_id, seat_order, contribution, folded, all_in, shown, hole, delta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(match_id, user_id) DO UPDATE SET
         seat_order = excluded.seat_order,
         contribution = excluded.contribution,
         folded = excluded.folded,
         all_in = excluded.all_in,
         shown = excluded.shown,
         hole = excluded.hole,
         delta = excluded.delta`,
      matchId,
      player.userId,
      player.seatOrder,
      player.contribution,
      player.folded ? 1 : 0,
      player.allIn ? 1 : 0,
      player.shown ? 1 : 0,
      player.hole === null ? null : JSON.stringify(player.hole),
      player.delta,
    );
  }
}

export interface FinishedMatch {
  matchId: number;
  endedAt: number;
  pot: number;
  board: Card[];
  winners: number[];
  log: unknown;
}

export function finishMatch(sql: SqlStorage, info: FinishedMatch): void {
  sql.exec(
    `UPDATE matches
     SET status = 'done', ended_at = ?, pot = ?, board = ?, winner_ids = ?, log = ?
     WHERE id = ?`,
    info.endedAt,
    info.pot,
    JSON.stringify(info.board),
    JSON.stringify(info.winners),
    JSON.stringify(info.log),
    info.matchId,
  );
}

export function matchPlayerWrites(state: {
  players: PlayerState[];
  deltas: Record<number, number>;
}): MatchPlayerWrite[] {
  return state.players.map((player) => ({
    userId: player.userId,
    seatOrder: player.seat,
    contribution: player.contribution,
    folded: player.folded,
    allIn: player.allIn,
    shown: player.shown,
    hole: player.hole,
    delta: state.deltas[player.userId] ?? 0,
  }));
}

export function addHandStats(
  sql: SqlStorage,
  userId: number,
  won: boolean,
  payout: number,
  delta: number,
): void {
  const chipsWon = delta > 0 ? delta : 0;
  const chipsLost = delta < 0 ? -delta : 0;
  sql.exec(
    `UPDATE players
     SET hands_played = hands_played + 1,
         hands_won = hands_won + ?,
         chips_won = chips_won + ?,
         chips_lost = chips_lost + ?,
         biggest_pot = MAX(biggest_pot, ?)
     WHERE user_id = ?`,
    won ? 1 : 0,
    chipsWon,
    chipsLost,
    won ? payout : 0,
    userId,
  );
}

export function updateBestHand(
  sql: SqlStorage,
  userId: number,
  handName: string,
  category: number,
): void {
  const player = getPlayer(sql, userId);
  if (!player) {
    return;
  }
  const stored = player.best_hand;
  const storedCategory = stored === null ? -1 : categoryFromName(stored);
  if (category > storedCategory) {
    sql.exec("UPDATE players SET best_hand = ? WHERE user_id = ?", handName, userId);
  }
}

export function categoryFromName(name: string): number {
  const table: [string, number][] = [
    ["Straight flush", 8],
    ["Four of a kind", 7],
    ["Full house", 6],
    ["Flush", 5],
    ["Straight", 4],
    ["Three of a kind", 3],
    ["Two pair", 2],
    ["Pair", 1],
    ["High card", 0],
  ];
  for (const [prefix, category] of table) {
    if (name.startsWith(prefix)) {
      return category;
    }
  }
  return -1;
}

export function leaderboard(sql: SqlStorage, limit = 5): PlayerRow[] {
  return sql
    .exec("SELECT * FROM players ORDER BY balance DESC, user_id ASC LIMIT ?", limit)
    .toArray() as unknown as PlayerRow[];
}

export function pruneMatches(sql: SqlStorage, limit = HISTORY_LIMIT): void {
  sql.exec(
    `DELETE FROM match_players WHERE match_id IN (
       SELECT id FROM matches ORDER BY id DESC LIMIT -1 OFFSET ?
     )`,
    limit,
  );
  sql.exec(
    `DELETE FROM matches WHERE id IN (
       SELECT id FROM matches ORDER BY id DESC LIMIT -1 OFFSET ?
     )`,
    limit,
  );
}

export function lastFinishedMatchPlayers(sql: SqlStorage): number[] {
  const match = sql
    .exec("SELECT id FROM matches WHERE status = 'done' ORDER BY id DESC LIMIT 1")
    .toArray() as { id: number }[];
  const matchId = match[0]?.id;
  if (matchId === undefined) {
    return [];
  }
  return (
    sql
      .exec("SELECT user_id FROM match_players WHERE match_id = ? ORDER BY seat_order ASC", matchId)
      .toArray() as { user_id: number }[]
  ).map((row) => row.user_id);
}

export interface HistoryRow {
  hand_no: number;
  board: string | null;
  winner_ids: string | null;
  delta: number;
  hole: string | null;
  pot: number | null;
}

export function playerHistory(sql: SqlStorage, userId: number, limit: number): HistoryRow[] {
  return sql
    .exec(
      `SELECT m.hand_no AS hand_no, m.board AS board, m.winner_ids AS winner_ids,
              m.pot AS pot, mp.delta AS delta, mp.hole AS hole
       FROM match_players mp
       JOIN matches m ON m.id = mp.match_id
       WHERE mp.user_id = ? AND m.status = 'done' AND m.hand_no IS NOT NULL
       ORDER BY m.id DESC
       LIMIT ?`,
      userId,
      limit,
    )
    .toArray() as unknown as HistoryRow[];
}

export function setDaily(sql: SqlStorage, userId: number, at: number): void {
  sql.exec("UPDATE players SET last_daily_at = ? WHERE user_id = ?", at, userId);
}

export function wipeGroup(sql: SqlStorage): void {
  sql.exec("DELETE FROM match_players");
  sql.exec("DELETE FROM matches");
  sql.exec("DELETE FROM players");
  sql.exec("DELETE FROM processed_updates");
  sql.exec("DELETE FROM meta WHERE key != 'schema_version' AND key != 'group_title'");
}
