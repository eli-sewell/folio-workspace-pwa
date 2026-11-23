CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE workspaces (
  owner_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  workspace TEXT NOT NULL CHECK (json_valid(workspace) AND json_type(workspace) = 'object')
) STRICT;
