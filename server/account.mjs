import { randomUUID } from 'node:crypto';
import { stdin } from 'node:process';
import { hashPassword, normalizeEmail } from './auth.mjs';
import { openDatabase } from './db.mjs';

async function main() {
  const [command, rawEmail, id = randomUUID()] = process.argv.slice(2);
  const email = normalizeEmail(rawEmail ?? '');
  if (!['create', 'reset-password'].includes(command) || process.argv.length > 5 ||
      (command === 'reset-password' && process.argv.length !== 4) ||
      email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id) || stdin.isTTY) {
    throw new Error('Pipe a password to account.mjs create EMAIL [UUID] or account.mjs reset-password EMAIL.');
  }

  stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 1026) throw new Error('Password input is too long.');
  }
  const password = input.replace(/\r?\n$/, '');
  if (password.length < 12 || Buffer.byteLength(password) > 1024) {
    throw new Error('Use a password of at least 12 characters and at most 1024 bytes.');
  }

  const hash = await hashPassword(password);
  const db = openDatabase();
  try {
    if (command === 'create') {
      db.prepare('INSERT INTO accounts VALUES (?, ?, ?)').run(id, email, hash);
    } else {
      db.exec('BEGIN IMMEDIATE;');
      const account = db.prepare('UPDATE accounts SET password_hash = ? WHERE email = ? RETURNING id').get(hash, email);
      if (!account) throw new Error('Account not found.');
      db.prepare('DELETE FROM sessions WHERE owner_id = ?').run(account.id);
      db.exec('COMMIT;');
    }
    console.log(command === 'create' ? 'Account created.' : 'Password reset and sessions revoked.');
  } finally {
    db.close();
  }
}

process.umask(0o077);
try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
