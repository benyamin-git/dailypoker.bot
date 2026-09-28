import { PRUNE_UPDATES_AFTER_MS, PRUNE_UPDATES_THRESHOLD } from "../config";

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
