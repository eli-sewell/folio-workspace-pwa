import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createBackup, restoreBackup, verifyBackup } from '../server/backup.mjs';
import { openDatabase } from '../server/db.mjs';

test('a consistent SQLite backup verifies and restores to a clean database', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'folio-backup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'folio.sqlite');
  const db = openDatabase(source);
  db.prepare('INSERT INTO accounts VALUES (?, ?, ?)').run('owner', 'owner@example.test', 'hash');
  const backup = createBackup(db, join(directory, 'backups'), 2);
  db.close();
  assert.equal(verifyBackup(backup), backup);
  const restored = restoreBackup(backup, join(directory, 'restored.sqlite'));
  const check = openDatabase(restored);
  assert.equal(check.prepare('SELECT email FROM accounts').get().email, 'owner@example.test');
  check.close();
});
