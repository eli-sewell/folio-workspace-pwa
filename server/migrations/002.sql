CREATE TABLE push_config (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL
) STRICT;

CREATE TABLE push_devices (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  registered_at INTEGER NOT NULL
) STRICT;

CREATE INDEX push_devices_owner ON push_devices(owner_id);

CREATE TABLE push_deliveries (
  device_id TEXT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
  reminder_id TEXT NOT NULL,
  due INTEGER NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL,
  sent_at INTEGER,
  last_error TEXT,
  PRIMARY KEY (device_id, reminder_id, due)
) STRICT;

CREATE INDEX push_deliveries_queue ON push_deliveries(state, next_attempt);
