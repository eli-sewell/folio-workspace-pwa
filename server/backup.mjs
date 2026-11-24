import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.mjs';

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const sqlString = value => "'" + value.replaceAll("'", "''") + "'";

export function verifyBackup(filename) {
  const check = new DatabaseSync(filename, { readOnly: true });
  try {
    if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('SQLite integrity check failed.');
    for (const table of ['accounts', 'sessions', 'workspaces', 'push_config', 'push_devices', 'push_deliveries']) {
      if (!check.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) throw new Error('Backup is missing ' + table + '.');
    }
  } finally { check.close(); }
  return filename;
}

export function createBackup(db, directory = process.env.FOLIO_BACKUP_DIR || '/backups', keep = Number(process.env.FOLIO_BACKUP_KEEP || 14)) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const temporary = join(directory, '.folio-' + stamp + '.sqlite.tmp');
  const target = join(directory, 'folio-' + stamp + '.sqlite');
  db.exec('PRAGMA wal_checkpoint(PASSIVE); VACUUM INTO ' + sqlString(temporary));
  verifyBackup(temporary);
  renameSync(temporary, target);
  const backups = readdirSync(directory).filter(name => /^folio-.*[.]sqlite$/.test(name)).sort().reverse();
  for (const name of backups.slice(Math.max(1, keep))) rmSync(join(directory, name));
  return target;
}

export function restoreBackup(source, target, replace = false) {
  verifyBackup(source);
  if (existsSync(target) && !replace) throw new Error('Restore target already exists. Pass --replace to overwrite it.');
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = target + '.restore-' + process.pid;
  copyFileSync(source, temporary);
  verifyBackup(temporary);
  if (existsSync(target)) rmSync(target);
  renameSync(temporary, target);
  return target;
}

export function startBackupScheduler(db) {
  const run = () => {
    try { console.log('Folio backup created:', basename(createBackup(db))); }
    catch (error) { console.error('Backup failed:', error.code || error.name); }
  };
  setTimeout(run, 5_000).unref();
  const timer = setInterval(run, 24 * 60 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}

if (isMain) {
  const command = process.argv[2];
  if (command === 'create') {
    const db = openDatabase();
    try { console.log(createBackup(db)); } finally { db.close(); }
  } else if (command === 'verify') {
    console.log(verifyBackup(process.argv[3]));
  } else if (command === 'restore') {
    console.log(restoreBackup(process.argv[3], process.argv[4], process.argv.includes('--replace')));
  } else {
    console.error('Usage: node server/backup.mjs create | verify FILE | restore SOURCE TARGET [--replace]');
    process.exitCode = 2;
  }
}
