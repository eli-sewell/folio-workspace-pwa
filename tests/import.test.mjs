import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDatabase } from '../server/db.mjs';
import { importSupabaseSnapshot } from '../server/import-supabase.mjs';

test('Supabase import preserves the production owner and replaces only its workspace', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'folio-import-'));
  const db = openDatabase(join(directory, 'folio.sqlite'));
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  const local = '11111111-1111-4111-8111-111111111111';
  const owner = '22222222-2222-4222-8222-222222222222';
  db.prepare('INSERT INTO accounts VALUES (?, ?, ?)').run(local, 'owner@example.test', 'password-hash');
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('session', local, Date.now() + 60_000);
  db.prepare('INSERT INTO workspaces VALUES (?, ?, ?)').run(local, 'local-revision', JSON.stringify({ version: 1, spaces: [{ id: 'local', name: 'Local' }], folders: [], docs: [] }));
  db.prepare('INSERT INTO push_devices VALUES (?, ?, ?, ?, ?, ?)').run('device', local, 'https://fcm.googleapis.com/fcm/send/test', 'A'.repeat(32), 'B'.repeat(24), Date.now());
  const workspace = { version: 1, spaces: [{ id: 'production', name: 'Production' }], folders: [], docs: [{ id: 'doc', title: 'Imported', tags: [] }], reminders: [] };
  const result = importSupabaseSnapshot(db, { owner_id: owner, email: 'OWNER@example.test', revision: 'production-revision', workspace });
  assert.equal(result.ownerId, owner);
  assert.equal(db.prepare('SELECT id FROM accounts').get().id, owner);
  assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n, 0);
  assert.equal(db.prepare('SELECT owner_id FROM push_devices').get().owner_id, owner);
  assert.deepEqual(JSON.parse(db.prepare('SELECT workspace FROM workspaces WHERE owner_id = ?').get(owner).workspace), workspace);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

