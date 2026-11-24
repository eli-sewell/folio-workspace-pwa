import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEmail } from './auth.mjs';
import { openDatabase } from './db.mjs';
import { validWorkspace } from './workspace.mjs';

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function importSupabaseSnapshot(db, snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      typeof snapshot.owner_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(snapshot.owner_id) ||
      typeof snapshot.email !== 'string' || typeof snapshot.revision !== 'string' || snapshot.revision.length > 64 ||
      !validWorkspace(snapshot.workspace)) throw new Error('Invalid Supabase snapshot.');
  const email = normalizeEmail(snapshot.email);
  const account = db.prepare('SELECT id, email FROM accounts WHERE email = ?').get(email);
  if (!account) throw new Error('Create the matching local Folio account before importing.');
  const collision = db.prepare('SELECT email FROM accounts WHERE id = ? AND email <> ?').get(snapshot.owner_id, email);
  if (collision) throw new Error('The production owner ID is already used by another local account.');
  db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
  try {
    if (account.id !== snapshot.owner_id) {
      db.prepare('UPDATE accounts SET id = ? WHERE id = ?').run(snapshot.owner_id, account.id);
      db.prepare('UPDATE sessions SET owner_id = ? WHERE owner_id = ?').run(snapshot.owner_id, account.id);
      db.prepare('UPDATE workspaces SET owner_id = ? WHERE owner_id = ?').run(snapshot.owner_id, account.id);
      db.prepare('UPDATE push_devices SET owner_id = ? WHERE owner_id = ?').run(snapshot.owner_id, account.id);
    }
    db.prepare(`INSERT INTO workspaces (owner_id, revision, workspace) VALUES (?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, workspace = excluded.workspace`)
      .run(snapshot.owner_id, snapshot.revision, JSON.stringify(snapshot.workspace));
    db.prepare('DELETE FROM sessions').run();
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeys.length) throw new Error('Imported snapshot has foreign-key violations.');
  return {
    ownerId: snapshot.owner_id,
    email,
    revision: snapshot.revision,
    bytes: Buffer.byteLength(JSON.stringify(snapshot.workspace)),
    documents: snapshot.workspace.docs.length,
    reminders: snapshot.workspace.reminders?.length || 0,
  };
}

if (isMain) {
  if (!process.argv[2]) {
    console.error('Usage: node server/import-supabase.mjs SNAPSHOT.json');
    process.exitCode = 2;
  } else {
    const snapshot = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const db = openDatabase();
    try { console.log(importSupabaseSnapshot(db, snapshot)); } finally { db.close(); }
  }
}

