import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';

test('the self-hosted PWA syncs two devices and preserves an offline conflicting draft', { timeout: 65_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'folio-web-'));
  const email = 'web@example.test';
  const password = 'browser test password';
  const env = { ...process.env, HOST: '127.0.0.1', PORT: '0', FOLIO_DB: join(directory, 'folio.sqlite') };
  const portProbe = createServer().listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const url = 'http://127.0.0.1:' + port;
  let browser;
  t.after(async () => {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  });
  const app = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...env, PORT: String(port), FOLIO_ORIGIN: url }, stdio: ['ignore', 'pipe', 'inherit']
  });
  t.after(async () => {
    if (app.exitCode !== null) return;
    const exit = once(app, 'exit');
    app.kill();
    await exit;
  });
  await once(app.stdout, 'data');

  const created = spawnSync(process.execPath, ['server/account.mjs', 'create', email], { env, input: password });
  assert.equal(created.status, 0, created.stderr?.toString());
  browser = await chromium.launch({ executablePath: process.env.FOLIO_CHROMIUM || undefined });
  const first = await browser.newContext();
  const second = await browser.newContext();
  // Keep API failures deterministic across focus changes and offline reloads.
  // Chromium still runs the real service worker for offline navigation.
  await second.addInitScript(() => {
    const request = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const target = typeof input === 'string' ? input : input.url;
      if (target?.startsWith('/api/') && localStorage.getItem('folio-test-api-offline')) {
        return Promise.reject(new TypeError('Test connection unavailable'));
      }
      return request(input, init);
    };
  });
  const a = await first.newPage();
  const b = await second.newPage();
  a.setDefaultTimeout(12_000);
  b.setDefaultTimeout(12_000);

  async function status(page, text) {
    try {
      await page.waitForFunction(expected => document.querySelector('#save-status')?.textContent === expected, text);
    } catch (error) {
      throw new Error('Expected ' + text + ', got ' + await page.locator('#save-status').textContent(), { cause: error });
    }
  }
  async function signIn(page) {
    await page.goto(url);
    await page.locator('.account-toggle').click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
    await page.locator('.account-toggle').filter({ hasText: 'Account' }).waitFor();
    await status(page, 'Synced');
  }
  async function newNote(page, title) {
    await page.bringToFront();
    await page.keyboard.press('Control+n');
    await page.locator('#doc-title').fill(title);
    await page.locator('.writing-area').fill(title + ' body');
  }
  await signIn(a);
  await newNote(a, 'Note from device A');
  await status(a, 'Synced');
  await signIn(b);
  await b.getByRole('heading', { name: 'Note from device A' }).waitFor();
  await b.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await b.reload();
  await b.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await newNote(a, 'Another note from device A');
  await status(a, 'Synced');
  await b.bringToFront();
  await b.evaluate(() => window.dispatchEvent(new Event('focus')));
  await b.getByRole('heading', { name: 'Another note from device A' }).waitFor();

  await b.evaluate(() => localStorage.setItem('folio-test-api-offline', '1'));
  await second.setOffline(true);
  await b.waitForFunction(() => !navigator.onLine);
  await newNote(b, 'Offline draft from device B');
  await status(b, 'Saved on this device · Sync pending');
  await b.reload();
  await b.waitForFunction(() => !navigator.onLine);
  await b.getByRole('heading', { name: 'Offline draft from device B' }).waitFor();

  await newNote(a, 'New revision from device A');
  await status(a, 'Synced');
  await b.bringToFront();
  await b.evaluate(() => localStorage.removeItem('folio-test-api-offline'));
  await second.setOffline(false);
  await status(b, 'Sync conflict · Open Account');
  await b.getByRole('heading', { name: 'Offline draft from device B' }).waitFor();
  await b.locator('.account-toggle').click();
  const download = b.waitForEvent('download');
  b.once('dialog', dialog => dialog.accept());
  await b.getByRole('button', { name: 'Open server version' }).click();
  const exported = await download;
  assert.equal(exported.suggestedFilename(), 'Folio-draft.json');
  const draft = JSON.parse(await readFile(await exported.path(), 'utf8'));
  assert.ok(draft.docs.some(doc => doc.title === 'Offline draft from device B'));
  await b.getByRole('heading', { name: 'New revision from device A' }).waitFor();
  assert.equal(await b.getByRole('heading', { name: 'Offline draft from device B' }).count(), 0);

  await b.locator('.account-toggle').click();
  await b.getByRole('button', { name: 'Sign out', exact: true }).click();
  await b.locator('.account-toggle').filter({ hasText: 'Sign in' }).waitFor();
  assert.equal(await b.getByRole('heading', { name: 'New revision from device A' }).count(), 0);
});
