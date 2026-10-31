import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export interface SqlResult {
  toArray<T = unknown>(): T[];
  one<T = unknown>(): T;
}

export interface Sql {
  exec(sql: string, ...params: unknown[]): SqlResult;
}

class Rows implements SqlResult {
  constructor(private readonly rows: Record<string, unknown>[]) {}

  toArray<T = unknown>(): T[] {
    return this.rows as T[];
  }

  one<T = unknown>(): T {
    const row = this.rows[0];
    if (row === undefined) {
      throw new Error("expected one row, got none");
    }
    return row as T;
  }
}

export class Database implements Sql {
  constructor(private readonly db: DatabaseSync) {}

  exec(sql: string, ...params: unknown[]): SqlResult {
    const rows = this.db.prepare(sql).all(...(params as SQLInputValue[]));
    return new Rows(rows);
  }

  close(): void {
    this.db.close();
  }
}

export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return new Database(db);
}
