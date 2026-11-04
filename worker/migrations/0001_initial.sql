PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE auth_attempts (
  client_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_key, window_start)
);

CREATE TABLE app_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE movements (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  type TEXT NOT NULL CHECK(type IN ('Entrata', 'Uscita')),
  description TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount >= 0),
  category TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX movements_user_date_idx ON movements(user_id, date DESC);

CREATE TABLE monthly_budgets (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  amount REAL NOT NULL CHECK(amount >= 0),
  PRIMARY KEY (user_id, year, month)
);

CREATE TABLE category_budgets (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  category TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount >= 0),
  percentage REAL NOT NULL CHECK(percentage >= 0),
  PRIMARY KEY (user_id, year, month, category)
);

CREATE TABLE balances (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  account_opening REAL NOT NULL DEFAULT 0,
  cash_opening REAL NOT NULL DEFAULT 0,
  investment_opening REAL NOT NULL DEFAULT 0,
  account_final REAL,
  cash_final REAL,
  investment_final REAL,
  PRIMARY KEY (user_id, year, month)
);

