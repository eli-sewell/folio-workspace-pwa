import { randomUUID } from 'node:crypto';
import webpush from 'web-push';

const endpointPattern = /^https:\/\/(?:fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|(?:[a-z0-9-]+\.)*notify\.windows\.com|(?:[a-z0-9-]+\.)*push\.apple\.com|(?:[a-z0-9-]+\.)*push\.samsungosp\.com)\//i;
const retryDelays = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];

export function ensurePushConfig(db) {
  let config = db.prepare('SELECT public_key, private_key FROM push_config WHERE singleton = 1').get();
  if (!config) {
    const keys = webpush.generateVAPIDKeys();
    db.prepare('INSERT INTO push_config VALUES (1, ?, ?)').run(keys.publicKey, keys.privateKey);
    config = { public_key: keys.publicKey, private_key: keys.privateKey };
  }
  return config;
}

export function listPushDevices(db, ownerId) {
  return db.prepare('SELECT endpoint FROM push_devices WHERE owner_id = ? ORDER BY registered_at').all(ownerId);
}

function validKey(value) {
  return typeof value === 'string' && value.length >= 16 && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function registerPushDevice(db, ownerId, subscription) {
  const endpoint = subscription?.endpoint;
  const keys = subscription?.keys;
  if (typeof endpoint !== 'string' || endpoint.length > 4096 || !endpointPattern.test(endpoint) ||
      !validKey(keys?.p256dh) || !validKey(keys?.auth)) throw Object.assign(new Error('Invalid push subscription.'), { status: 400 });
  const existing = db.prepare('SELECT owner_id FROM push_devices WHERE endpoint = ?').get(endpoint);
  if (existing && existing.owner_id !== ownerId) throw Object.assign(new Error('This device belongs to another account.'), { status: 409 });
  db.prepare(`
    INSERT INTO push_devices (id, owner_id, endpoint, p256dh, auth, registered_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, registered_at = excluded.registered_at
  `).run(randomUUID(), ownerId, endpoint, keys.p256dh, keys.auth, Date.now());
}

export function removePushDevice(db, ownerId, endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 4096) throw Object.assign(new Error('Invalid push subscription.'), { status: 400 });
  db.prepare('DELETE FROM push_devices WHERE owner_id = ? AND endpoint = ?').run(ownerId, endpoint);
}

function queueDueReminders(db, now) {
  const workspaces = db.prepare('SELECT owner_id, workspace FROM workspaces').all();
  const devices = db.prepare('SELECT id, owner_id, registered_at FROM push_devices').all();
  const byOwner = new Map();
  for (const device of devices) {
    const list = byOwner.get(device.owner_id) || [];
    list.push(device);
    byOwner.set(device.owner_id, list);
  }
  const insert = db.prepare(`
    INSERT OR IGNORE INTO push_deliveries
      (device_id, reminder_id, due, title, state, attempts, next_attempt)
    VALUES (?, ?, ?, ?, 'pending', 0, ?)
  `);
  for (const row of workspaces) {
    const ownerDevices = byOwner.get(row.owner_id);
    if (!ownerDevices?.length) continue;
    let reminders;
    try { reminders = JSON.parse(row.workspace).reminders; } catch { continue; }
    if (!Array.isArray(reminders)) continue;
    for (const reminder of reminders) {
      if (typeof reminder?.id !== 'string' || !Number.isFinite(reminder.time) || reminder.time > now) continue;
      for (const device of ownerDevices) {
        if (reminder.time < Math.max(device.registered_at, now - 86_400_000)) continue;
        insert.run(device.id, reminder.id, reminder.time, String(reminder.title || 'A reminder is due.').slice(0, 180), now);
      }
    }
  }
}

export async function runPushScheduler(db, origin, send = webpush.sendNotification) {
  const now = Date.now();
  const config = ensurePushConfig(db);
  webpush.setVapidDetails(origin, config.public_key, config.private_key);
  queueDueReminders(db, now);
  const jobs = db.prepare(`
    SELECT q.*, d.endpoint, d.p256dh, d.auth FROM push_deliveries q
    JOIN push_devices d ON d.id = q.device_id
    WHERE q.state = 'pending' AND q.next_attempt <= ? ORDER BY q.due LIMIT 40
  `).all(now);
  for (const job of jobs) {
    const attempts = job.attempts + 1;
    db.prepare('UPDATE push_deliveries SET attempts = ?, next_attempt = ? WHERE device_id = ? AND reminder_id = ? AND due = ?')
      .run(attempts, now + 120_000, job.device_id, job.reminder_id, job.due);
    try {
      await send({ endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } },
        JSON.stringify({ title: job.title, id: job.reminder_id }), { TTL: 86_400, timeout: 10_000 });
      db.prepare(`UPDATE push_deliveries SET state = 'sent', sent_at = ?, last_error = NULL
        WHERE device_id = ? AND reminder_id = ? AND due = ?`).run(Date.now(), job.device_id, job.reminder_id, job.due);
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) {
        db.prepare('DELETE FROM push_devices WHERE id = ?').run(job.device_id);
      } else {
        const failed = attempts >= retryDelays.length + 1;
        db.prepare(`UPDATE push_deliveries SET state = ?, next_attempt = ?, last_error = ?
          WHERE device_id = ? AND reminder_id = ? AND due = ?`)
          .run(failed ? 'failed' : 'pending', now + (retryDelays[attempts - 1] || retryDelays.at(-1)),
            String(error.statusCode || error.code || error.name || 'delivery error').slice(0, 120),
            job.device_id, job.reminder_id, job.due);
        console.error('Push delivery failed:', error.statusCode || error.code || error.name);
      }
    }
  }
  db.prepare("DELETE FROM push_deliveries WHERE (state = 'sent' AND sent_at < ?) OR (state = 'failed' AND next_attempt < ?)")
    .run(now - 90 * 86_400_000, now - 30 * 86_400_000);
  return jobs.length;
}

export function startPushScheduler(db, origin) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runPushScheduler(db, origin); }
    catch (error) { console.error('Push scheduler failed:', error.code || error.name); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 30_000);
  timer.unref();
  setTimeout(tick, 2_000).unref();
  return () => clearInterval(timer);
}
