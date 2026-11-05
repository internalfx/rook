-- Users: everyone who can log in (see services/users.js). Each user's chats, memories, tasks,
-- briefings and notifications are theirs alone, with a userId on each; chat messages belong to
-- their chat. User 1 is the owner from config.js: it's made empty here, and the first start fills
-- it in from config.owner.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  -- Compared without case, so a login works however the email is typed
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  -- From Bun.password.hash; empty until it's set
  passhash TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

INSERT INTO users (id, email, name, passhash, createdAt, updatedAt)
VALUES (1, '', '', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Each user's own settings (services/settings.js): their ntfy topic, Slack token and picks, time
-- zone, and when they last saw the Briefing and Notifications pages. What applies to everyone
-- (the models, tools and briefing schedule) is in config.js now, so the old settings table goes
-- once the owner's personal rows are moved over.

CREATE TABLE userSettings (
  userId INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  type TEXT,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (userId, key)
);

INSERT INTO userSettings (userId, key, value, type, updatedAt)
SELECT 1, key, value, type, updatedAt FROM settings
WHERE key IN ('ntfyUrl', 'ntfyToken', 'slackChannels', 'briefingViewedAt', 'notificationsViewedAt');

DROP TABLE settings;

-- Whose each row is. Everything so far is the owner's. The column has to allow null: with
-- foreign keys on, SQLite won't add a NOT NULL column that references another table, and
-- rebuilding chats instead would cascade-delete its messages. A row with no user is nobody's,
-- and is never shown.

ALTER TABLE chats ADD COLUMN userId INTEGER REFERENCES users (id) ON DELETE CASCADE;
UPDATE chats SET userId = 1;
CREATE INDEX chats_userId ON chats (userId, updatedAt);

ALTER TABLE memories ADD COLUMN userId INTEGER REFERENCES users (id) ON DELETE CASCADE;
UPDATE memories SET userId = 1;
CREATE INDEX memories_userId ON memories (userId, updatedAt);

ALTER TABLE tasks ADD COLUMN userId INTEGER REFERENCES users (id) ON DELETE CASCADE;
UPDATE tasks SET userId = 1;
CREATE INDEX tasks_userId ON tasks (userId, doneAt);

ALTER TABLE briefings ADD COLUMN userId INTEGER REFERENCES users (id) ON DELETE CASCADE;
UPDATE briefings SET userId = 1;
CREATE INDEX briefings_userId ON briefings (userId, startedAt);

ALTER TABLE notifications ADD COLUMN userId INTEGER REFERENCES users (id) ON DELETE CASCADE;
UPDATE notifications SET userId = 1;
CREATE INDEX notifications_userId ON notifications (userId, createdAt);

ALTER TABLE scheduledNotifications ADD COLUMN userId INTEGER REFERENCES users (id) ON DELETE CASCADE;
UPDATE scheduledNotifications SET userId = 1;
CREATE INDEX scheduledNotifications_userId ON scheduledNotifications (userId, status, sendAt);
