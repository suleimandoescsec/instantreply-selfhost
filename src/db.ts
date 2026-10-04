import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS suppressed (wa_id TEXT PRIMARY KEY, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS handoff (wa_id TEXT PRIMARY KEY, at INTEGER NOT NULL, reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, wa_id TEXT NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_wa ON messages (wa_id, id);
  `);
  return db;
}

/** Drop stored chat text older than N days (message ids and the suppression list are kept). */
export function purgeOld(db: Db, days: number, now = Date.now()) {
  db.prepare('DELETE FROM messages WHERE at < ?').run(now - days * 86_400_000);
}
