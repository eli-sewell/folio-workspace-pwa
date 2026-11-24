import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(filename = process.env.FOLIO_DB || '/data/folio.sqlite') {
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; BEGIN IMMEDIATE;');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 2) throw new Error('The database requires a newer version of Folio.');
    if (version === 0) {
      db.exec(readFileSync(new URL('./migrations/001.sql', import.meta.url), 'utf8'));
      db.exec('PRAGMA user_version = 1;');
    }
    if (version < 2) {
      db.exec(readFileSync(new URL('./migrations/002.sql', import.meta.url), 'utf8'));
      db.exec('PRAGMA user_version = 2;');
    }
    db.exec('COMMIT;');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
