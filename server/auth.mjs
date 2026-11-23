import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const sessionSeconds = 7 * 24 * 60 * 60;
const cookie = '__Host-folio_session';

export const normalizeEmail = email => email.trim().toLowerCase();
const tokenHash = token => createHash('sha256').update(token).digest('hex');

export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  return salt + ':' + key.toString('hex');
}

export async function verifyPassword(password, hash) {
  const computed = await hashPassword(password, hash?.split(':')[0] ?? '0'.repeat(32));
  return Boolean(hash && timingSafeEqual(Buffer.from(hash), Buffer.from(computed)));
}

export function sessionCookie(token = '', seconds = 0) {
  return `${cookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}

export function sessionHash(request) {
  const value = request.headers.cookie?.split(';').map(item => item.trim())
    .find(item => item.startsWith(cookie + '='))?.slice(cookie.length + 1);
  return /^[a-f0-9]{64}$/.test(value ?? '') ? tokenHash(value) : null;
}

export function createSession(db, owner, previousHash) {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR token_hash = ?').run(now, previousHash);
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(tokenHash(token), owner, now + sessionSeconds * 1000);
  return sessionCookie(token, sessionSeconds);
}
