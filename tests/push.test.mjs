import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDatabase } from '../server/db.mjs';
import { registerPushDevice, runPushScheduler } from '../server/push.mjs';

test('push jobs are durable, retry failures, and send each reminder once', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'folio-push-'));
  const db = openDatabase(join(directory, 'folio.sqlite'));
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  db.prepare('INSERT INTO accounts VALUES (?, ?, ?)').run('owner', 'owner@example.test', 'hash');
  const due = Date.now() - 100;
  db.prepare('INSERT INTO workspaces VALUES (?, ?, ?)').run('owner', 'revision', JSON.stringify({
    version: 1, spaces: [{ id: 'space', name: 'Space' }], folders: [], docs: [],
    reminders: [{ id: 'reminder', title: 'Test reminder', time: due }],
  }));
  registerPushDevice(db, 'owner', {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-device',
    keys: { p256dh: 'A'.repeat(32), auth: 'B'.repeat(24) },
  });
  db.prepare('UPDATE push_devices SET registered_at = ?').run(due - 1_000);
  let attempts = 0;
  await runPushScheduler(db, 'https://folio.example.test', async () => {
    attempts++;
    throw Object.assign(new Error('temporary'), { statusCode: 503 });
  });
  assert.equal(attempts, 1);
  assert.deepEqual({ ...db.prepare('SELECT state, attempts FROM push_deliveries').get() }, { state: 'pending', attempts: 1 });
  db.prepare('UPDATE push_deliveries SET next_attempt = 0').run();
  await runPushScheduler(db, 'https://folio.example.test', async (subscription, payload) => {
    attempts++;
    assert.match(subscription.endpoint, /test-device$/);
    assert.deepEqual(JSON.parse(payload), { title: 'Test reminder', id: 'reminder' });
  });
  assert.equal(attempts, 2);
  assert.deepEqual({ ...db.prepare('SELECT state, attempts FROM push_deliveries').get() }, { state: 'sent', attempts: 2 });
  await runPushScheduler(db, 'https://folio.example.test', async () => { attempts++; });
  assert.equal(attempts, 2);
});
