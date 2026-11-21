import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Lightweight in-memory SQLite shim implementing the subset of Cloudflare D1Database
 * used by the Worker, powered by Node 22's built-in `node:sqlite`.
 */
export function createTestD1(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  const migrationSql = readFileSync(
    resolve(process.cwd(), 'migrations/0001_initial.sql'),
    'utf-8',
  );
  sqlite.exec(migrationSql);

  const makeStatement = (sql: string, params: unknown[] = []): D1PreparedStatement => {
    const stmt: D1PreparedStatement = {
      bind(...values: unknown[]) {
        return makeStatement(sql, values);
      },
      async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
        const prepared = sqlite.prepare(sql);
        const row = prepared.get(...(params as never[])) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (colName) return (row[colName] as T) ?? null;
        return row as T;
      },
      async all<T = Record<string, unknown>>() {
        const prepared = sqlite.prepare(sql);
        const rows = prepared.all(...(params as never[])) as T[];
        return {
          results: rows,
          success: true,
          meta: {
            duration: 0,
            size_after: 0,
            rows_read: rows.length,
            rows_written: 0,
            last_row_id: 0,
            changed_db: false,
            changes: 0,
          },
        };
      },
      async run() {
        const prepared = sqlite.prepare(sql);
        const info = prepared.run(...(params as never[]));
        return {
          results: [],
          success: true,
          meta: {
            duration: 0,
            size_after: 0,
            rows_read: 0,
            rows_written: Number(info.changes),
            last_row_id: Number(info.lastInsertRowid ?? 0),
            changed_db: Number(info.changes) > 0,
            changes: Number(info.changes),
          },
        };
      },
      async raw<T = unknown[]>() {
        const prepared = sqlite.prepare(sql);
        const rows = prepared.all(...(params as never[])) as Record<string, unknown>[];
        return rows.map((r) => Object.values(r)) as T[];
      },
    } as unknown as D1PreparedStatement;

    return stmt;
  };

  return {
    prepare(sql: string) {
      return makeStatement(sql);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      const results: D1Result<T>[] = [];
      sqlite.exec('BEGIN');
      try {
        for (const st of statements) {
          const res = (await st.run()) as D1Result<T>;
          results.push(res);
        }
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
      return results;
    },
    async exec(query: string) {
      sqlite.exec(query);
      return { count: 1, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;
}
