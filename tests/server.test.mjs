import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('local accounts, session revocation, workspace ownership and revision checks survive a restart', { timeout: 20_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'folio-server-'));
  const origin = 'https://folio.example.test';
  const env = { ...process.env, HOST: '127.0.0.1', PORT: '0', FOLIO_ORIGIN: origin, FOLIO_DB: join(directory, 'folio.sqlite'), FOLIO_DISABLE_JOBS: '1' };
  const password = 'a test password with enough characters';
  let server;
  let base;
  async function stop() {
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });
  async function start() {
    server = spawn(process.execPath, ['server/index.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
    const address = await Promise.race([
      once(server.stdout, 'data').then(([chunk]) => chunk.toString()),
      once(server, 'exit').then(([code]) => { throw new Error('Server exited with code ' + code); }),
    ]);
    base = 'http://127.0.0.1:' + address.match(/127\.0\.0\.1:(\d+)/)[1];
  }
  function account(command, email, input = password) {
    const result = spawnSync(process.execPath, ['server/account.mjs', command, email], { env, input, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  function request(path, { method = 'GET', cookie, body, from = origin, headers = {} } = {}) {
    return fetch(base + '/api/' + path, {
      method,
      headers: { ...headers, Origin: from, ...(cookie && { Cookie: cookie }), ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
    });
  }
  async function login(email, secret = password) {
    const response = await request('login', { method: 'POST', body: { email, password: secret } });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
    return cookie.split(';')[0];
  }

  account('create', 'one@example.test');
  account('create', 'two@example.test');
  await start();
  assert.equal((await request('health')).status, 200);
  assert.equal((await request('workspace')).status, 401);
  assert.equal((await request('login', { method: 'POST', from: 'https://other.example.test' })).status, 403);
  assert.equal((await request('login', { method: 'POST', body: { email: 'one@example.test', password: 'wrong' } })).status, 401);
  const first = await login('ONE@example.test');
  const second = await login('two@example.test');
  const workspace = { version: 1, spaces: [{ id: 'space', name: 'Test space' }], folders: [], docs: [] };
  const save = (revision, value = workspace) => request('workspace', { method: 'PUT', cookie: first, body: { revision, workspace: value } });
  assert.equal((await save(null, { version: 2 })).status, 400);
  const initial = await save(null);
  assert.equal(initial.status, 200);
  const { revision } = await initial.json();
  assert.equal(await (await request('workspace', { cookie: second })).json(), null);
  const identity = await (await request('session', { cookie: first })).json();
  assert.match((await (await request('push/key', { cookie: first })).json()).publicKey, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await (await request('push/devices', { cookie: first })).json(), []);
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-device',
    keys: { p256dh: 'A'.repeat(32), auth: 'B'.repeat(24) },
  };
  assert.equal((await request('push/devices', { method: 'POST', cookie: first, body: { subscription } })).status, 204);
  assert.deepEqual(await (await request('push/devices', { cookie: first })).json(), [{ endpoint: subscription.endpoint }]);
  assert.equal((await request('push/devices', { method: 'DELETE', cookie: first, body: { endpoint: subscription.endpoint } })).status, 204);
  assert.deepEqual(await (await request('push/devices', { cookie: first })).json(), []);
  assert.equal((await request('workspace', { cookie: second, headers: { 'X-Folio-Account': identity.id } })).status, 401);
  assert.equal((await request('workspace', { cookie: first, headers: { 'If-None-Match': '"' + revision + '"' } })).status, 304);
  const edits = await Promise.all([save(revision), save(revision)]);
  assert.deepEqual(edits.map(response => response.status).sort(), [200, 409]);
  const latest = await edits.find(response => response.ok).json();

  await stop();
  await start();
  assert.deepEqual(await (await request('workspace', { cookie: first })).json(), { ...latest, workspace });
  assert.equal((await request('logout', { method: 'POST', cookie: first })).status, 204);
  assert.equal((await request('session', { cookie: first })).status, 401);

  const oldSession = await login('one@example.test');
  const newPassword = 'a different test password';
  account('reset-password', 'one@example.test', newPassword);
  assert.equal((await request('session', { cookie: oldSession })).status, 401);
  await login('one@example.test', newPassword);
});
