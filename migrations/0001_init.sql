-- Opal Carindale site bookings: initial schema (Cloudflare D1 / SQLite)

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,          -- lower-case, trimmed name for duplicate checks
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,             -- lower-case
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  company_id TEXT NOT NULL REFERENCES companies(id),
  role TEXT NOT NULL DEFAULT 'member',    -- member | admin
  status TEXT NOT NULL DEFAULT 'pending', -- pending | active | disabled | deleted
  privacy_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX users_company ON users(company_id);

CREATE TABLE login_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,            -- epoch ms
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX login_codes_email ON login_codes(email, created_at);

CREATE TABLE signup_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                     -- crane | delivery | hoist | pump | mobile | hold | closure
  date TEXT NOT NULL,                     -- YYYY-MM-DD, Brisbane
  start REAL NOT NULL,                    -- decimal hours, 6.5 = 6:30am
  end REAL NOT NULL,
  resources TEXT NOT NULL,                -- JSON array
  level TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  details TEXT NOT NULL,
  extra TEXT NOT NULL DEFAULT '{}',       -- JSON: weight, radius, vehicle, load, volume, pump/mobile set-up
  company_id TEXT REFERENCES companies(id),
  user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',  -- active | cancelled
  created_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancel_reason TEXT
);
CREATE INDEX bookings_date ON bookings(date, status);
CREATE INDEX bookings_company ON bookings(company_id, date);

-- One row per half-hour per resource. The primary key makes double-booking impossible:
-- a booking and its slot rows are written in one batch, which fails as a whole on any clash.
CREATE TABLE slots (
  resource TEXT NOT NULL,
  date TEXT NOT NULL,
  slot INTEGER NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  PRIMARY KEY (resource, date, slot)
);
CREATE INDEX slots_booking ON slots(booking_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,                    -- JSON
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);
