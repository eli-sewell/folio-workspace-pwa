import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, normalizeEmail, sessionCookie, sessionHash, verifyPassword } from './auth.mjs';
import { openDatabase } from './db.mjs';
import { validWorkspace } from './workspace.mjs';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const origin = new URL(process.env.FOLIO_ORIGIN || 'http://localhost:3000').origin;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};
const workspaceLimit = 100 * 1024 * 1024;
let loginWindow = 0;
let loginAttempts = 0;
let activeLogins = 0;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readJson(request, limit) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new RequestError(415, 'Expected application/json.');
  }
  if (Number(request.headers['content-length']) > limit) throw new RequestError(413, 'Request is too large.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) throw new RequestError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    // Report malformed JSON without echoing private data.
  }
  throw new RequestError(400, 'Expected a JSON object.');
}

async function login(request, response, db) {
  const { email, password } = await readJson(request, 4096);
  if (typeof email !== 'string' || email.length > 254 ||
      typeof password !== 'string' || Buffer.byteLength(password) > 1024) {
    throw new RequestError(400, 'Invalid credentials.');
  }
  if (Date.now() >= loginWindow) {
    loginWindow = Date.now() + 60_000;
    loginAttempts = 0;
  }
  if (loginAttempts >= 12 || activeLogins >= 2) {
    response.setHeader('Retry-After', Math.max(1, Math.ceil((loginWindow - Date.now()) / 1000)));
    throw new RequestError(429, 'Try again shortly.');
  }
  loginAttempts++;
  activeLogins++;
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE email = ?').get(normalizeEmail(email));
    if (!await verifyPassword(password, account?.password_hash)) throw new RequestError(401, 'Invalid credentials.');
    // A reset may have completed while password verification was in progress.
    db.exec('BEGIN IMMEDIATE;');
    try {
      const current = db.prepare('SELECT password_hash FROM accounts WHERE id = ?').get(account.id);
      if (current?.password_hash !== account.password_hash) throw new RequestError(401, 'Invalid credentials.');
      const cookie = createSession(db, account.id, sessionHash(request));
      db.exec('COMMIT;');
      response.setHeader('Set-Cookie', cookie);
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
    json(response, 200, { id: account.id, email: account.email });
  } finally {
    activeLogins--;
  }
}

async function api(request, response, path, db) {
  const route = request.method + ' ' + path;
  if (route === 'GET /api/health') {
    db.prepare('SELECT 1 FROM accounts LIMIT 1').get();
    return json(response, 200, { status: 'ok' });
  }
  if (!['GET /api/session', 'POST /api/login', 'POST /api/logout', 'GET /api/workspace', 'PUT /api/workspace'].includes(route)) {
    throw new RequestError(404, 'Route not found.');
  }
  if (request.method !== 'GET' && request.headers.origin !== origin) {
    throw new RequestError(403, 'Request origin is not allowed.');
  }
  if (route === 'POST /api/login') return login(request, response, db);

  const hash = sessionHash(request);
  if (route === 'POST /api/logout') {
    const expected = request.headers['x-folio-account'];
    if (hash && expected) {
      const session = db.prepare('SELECT owner_id FROM sessions WHERE token_hash = ?').get(hash);
      if (session && session.owner_id !== expected) throw new RequestError(401, 'This session belongs to a different account.');
    }
    if (hash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    response.setHeader('Set-Cookie', sessionCookie());
    response.writeHead(204).end();
    return;
  }
  const account = hash && db.prepare(`
    SELECT accounts.id, accounts.email FROM sessions
    JOIN accounts ON accounts.id = sessions.owner_id
    WHERE token_hash = ? AND expires_at > ?
  `).get(hash, Date.now());
  if (!account || (request.headers['x-folio-account'] && request.headers['x-folio-account'] !== account.id)) {
    throw new RequestError(401, 'Sign in to the account that owns this workspace.');
  }
  if (route === 'GET /api/session') return json(response, 200, account);
  if (route === 'GET /api/workspace') {
    const row = db.prepare(`
      SELECT revision, CASE WHEN '"' || revision || '"' <> ? THEN workspace END AS workspace
      FROM workspaces WHERE owner_id = ?
    `).get(request.headers['if-none-match'] || '', account.id);
    if (!row) return json(response, 200, null);
    response.setHeader('ETag', '"' + row.revision + '"');
    if (row.workspace === null) {
      response.writeHead(304).end();
      return;
    }
    return json(response, 200, { revision: row.revision, workspace: JSON.parse(row.workspace) });
  }

  const { revision, workspace } = await readJson(request, workspaceLimit);
  if ((revision !== null && (typeof revision !== 'string' || revision.length > 64)) ||
      !validWorkspace(workspace)) {
    throw new RequestError(400, 'Invalid workspace or revision.');
  }
  const next = randomUUID();
  const snapshot = JSON.stringify(workspace);
  // Check the session again after reading the body. A logout or password reset can happen during an upload.
  const session = 'SELECT owner_id FROM sessions WHERE token_hash = ? AND expires_at > ?';
  const result = revision === null
    ? db.prepare(`INSERT INTO workspaces SELECT owner_id, ?, ? FROM (${session}) WHERE true ON CONFLICT(owner_id) DO NOTHING`)
      .run(next, snapshot, hash, Date.now())
    : db.prepare(`UPDATE workspaces SET revision = ?, workspace = ? WHERE owner_id = (${session}) AND revision = ?`)
      .run(next, snapshot, hash, Date.now(), revision);
  if (!result.changes) {
    if (!db.prepare(session).get(hash, Date.now())) throw new RequestError(401, 'Sign in required.');
    throw new RequestError(409, 'Workspace revision has changed.');
  }
  json(response, 200, { revision: next });
}

async function serveAsset(request, response, path) {
  if (!['GET', 'HEAD'].includes(request.method)) throw new RequestError(405, 'Method not allowed.');
  const file = resolve(dist, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(dist + sep)) throw new RequestError(404, 'File not found.');
  const info = await stat(file).catch(error => {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
  });
  if (!info?.isFile()) throw new RequestError(404, 'File not found.');
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(file)] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
  });
  if (request.method === 'HEAD') response.end();
  else {
    const stream = createReadStream(file);
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  }
}

process.umask(0o077);
const db = openDatabase();
const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  try {
    const rawPath = new URL(request.url, 'http://localhost').pathname;
    let path;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      throw new RequestError(400, 'Invalid URL.');
    }
    if (path.includes('\0')) throw new RequestError(400, 'Invalid URL.');
    if (path === '/api' || path.startsWith('/api/')) await api(request, response, path, db);
    else await serveAsset(request, response, path);
  } catch (error) {
    if (!(error instanceof RequestError)) console.error('Request failed:', error.code || error.name);
    if (response.headersSent) return response.destroy();
    if (!request.complete) response.setHeader('Connection', 'close');
    json(response, error.status || 500, { error: error.status ? error.message : 'Internal server error.' });
  }
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => {
  console.log(`Folio listening on ${server.address().address}:${server.address().port}`);
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => server.close(() => db.close()));
}
