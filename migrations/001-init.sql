-- Dates are ISO-8601 text, JSON columns are text

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  lastActive TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX sessions_lastActive ON sessions (lastActive);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  type TEXT,
  updatedAt TEXT NOT NULL
);
