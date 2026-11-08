-- ROOK's whole schema. Numbered 19 because the databases made before the migrations were
-- collapsed into this file are at version 19; the next migration is 020. Dates are ISO-8601 text,
-- and JSON columns are text.

-- Logins (middleware/session.js). data is a JSON object: the user's id once they've logged in.
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  lastActive TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX sessions_lastActive ON sessions (lastActive);

-- Everyone who can log in (lib/users.js). Each user's chats, memories, tasks, briefings and
-- notifications are theirs alone, with a userId on each; chat messages belong to their chat.
-- Accounts are made with scripts/users.js, and the first one made is an admin.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  -- Compared without case, so a login works however the email is typed
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  -- From Bun.password.hash
  passhash TEXT NOT NULL,
  -- Admins see the Admin page
  isAdmin INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Each user's own settings (lib/settings.js): their time zone, ntfy topic, Slack token and
-- picks, and when they last saw the Briefing and Notifications pages. What applies to everyone
-- (the models, tools and briefing schedule) is in config.js.
CREATE TABLE userSettings (
  userId INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  type TEXT,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (userId, key)
);

-- Conversations with the chat model (lib/chats.js)
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  userId INTEGER REFERENCES users (id) ON DELETE CASCADE,
  -- Written by the model after the first reply; null until then
  title TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX chats_updatedAt ON chats (updatedAt);
CREATE INDEX chats_userId ON chats (userId, updatedAt);

CREATE TABLE chatMessages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chatId TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  -- For 'tool' messages, the result as told to the model
  content TEXT NOT NULL,
  -- A thinking model's reasoning, kept separate from its answer
  reasoning TEXT NOT NULL DEFAULT '',
  -- assistant: the tool calls it made, as a JSON array in the OpenAI format
  toolCalls TEXT,
  -- tool: the id of the call this message answers
  toolCallId TEXT,
  -- tool: the image it generated (data/images/<imageId>.png), if any
  imageId TEXT,
  -- user: the images attached to the message, as a JSON array of ids (data/images/<id>.jpg);
  -- null when it has none
  imageIds TEXT,
  createdAt TEXT NOT NULL
);

CREATE INDEX chatMessages_chatId ON chatMessages (chatId);

-- Facts the chat model, or the user, saved for every chat to use (lib/memories.js)
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  userId INTEGER REFERENCES users (id) ON DELETE CASCADE,
  -- The memory itself, in plain language
  content TEXT NOT NULL,
  -- 1: sent at the start of every chat. 0: found with search_memories when it's relevant
  pinned INTEGER NOT NULL DEFAULT 0,
  -- The chat it was saved in, if the model saved it; kept when that chat is deleted
  chatId TEXT REFERENCES chats (id) ON DELETE SET NULL,
  -- content as a vector of float32s; null until it's embedded (lib/embeddings.js)
  embedding BLOB,
  -- The model that made `embedding`. Vectors from different models can't be compared, so a
  -- memory whose model isn't the one in config.js is embedded again before the next search.
  embeddingModel TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX memories_updatedAt ON memories (updatedAt);
CREATE INDEX memories_userId ON memories (userId, updatedAt);

-- Things a user needs to get done (lib/tasks.js). The chat model can add, find, change and
-- complete them; the user manages them on the Tasks page, and only the user can delete them.
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  userId INTEGER REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  -- The list sorts high first
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
  -- The day it's due, as YYYY-MM-DD in the user's time zone; null when it has no due date
  dueDate TEXT,
  -- When it was marked done; null while it's still to do
  doneAt TEXT,
  -- How a done task went, in a few words: what was done, anything left over, or why it no longer
  -- applied. Empty while it has none, and cleared when the task is put back on the list.
  doneNote TEXT NOT NULL DEFAULT '',
  -- The chat the model added it in; null when the user added it, and kept when that chat is deleted
  chatId TEXT REFERENCES chats (id) ON DELETE SET NULL,
  -- The title and notes as a vector of float32s, so find_tasks can search by meaning; null until
  -- it's embedded, which happens at the next search after the task is added or changed
  embedding BLOB,
  -- The model that made `embedding`; a task embedded by another model is embedded again
  embeddingModel TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX tasks_doneAt ON tasks (doneAt);
CREATE INDEX tasks_userId ON tasks (userId, doneAt);

-- Runs of the chat model in the background that look over a user's memories, tasks, recent
-- chats and Slack and write them an overview (services/briefings.js)
CREATE TABLE briefings (
  id TEXT PRIMARY KEY,
  userId INTEGER REFERENCES users (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  -- What started it: the schedule in config.js, or the Brief me now button
  startedBy TEXT NOT NULL CHECK (startedBy IN ('schedule', 'manual')),
  -- The model's closing summary; null until it's done
  overview TEXT,
  -- Why it failed, shown on the page
  error TEXT,
  -- What it did, in the chat page's own form: its replies, with their thinking, and each tool
  -- call with its result, as a JSON array
  transcript TEXT NOT NULL DEFAULT '[]',
  startedAt TEXT NOT NULL,
  finishedAt TEXT
);

CREATE INDEX briefings_startedAt ON briefings (startedAt);
CREATE INDEX briefings_userId ON briefings (userId, startedAt);

-- Notifications the model sent a user, kept in rook and pushed to their phone through ntfy when
-- it's set up in Settings (lib/notifications.js)
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  userId INTEGER REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  -- high is pushed with ntfy's high priority, which makes the phone more insistent
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  -- The briefing that sent it; kept when old briefings are deleted
  briefingId TEXT REFERENCES briefings (id) ON DELETE SET NULL,
  -- How pushing it went: 'sent', 'failed' (see pushError), or 'off' when ntfy isn't set up
  pushStatus TEXT NOT NULL CHECK (pushStatus IN ('sent', 'failed', 'off')),
  pushError TEXT,
  createdAt TEXT NOT NULL
);

CREATE INDEX notifications_createdAt ON notifications (createdAt);
CREATE INDEX notifications_briefingId ON notifications (briefingId);
CREATE INDEX notifications_userId ON notifications (userId, createdAt);

-- Notifications the model scheduled for later, in a chat or a briefing. Just before each is due,
-- the model checks it's still right and sends it, delays it or skips it
-- (services/notificationChecks.js). One that's sent is deleted from here: it's in notifications.
CREATE TABLE scheduledNotifications (
  id TEXT PRIMARY KEY,
  userId INTEGER REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  -- When to send it, as an ISO date; moved later when the check delays it
  sendAt TEXT NOT NULL,
  -- What the model that scheduled it wants checked before it goes out; may be empty
  checkNote TEXT NOT NULL DEFAULT '',
  -- Where it was scheduled: in a chat, or by a briefing. Kept apart from the ids below, which
  -- are cleared when that chat or briefing is deleted.
  source TEXT NOT NULL DEFAULT 'chat' CHECK (source IN ('chat', 'briefing')),
  briefingId TEXT REFERENCES briefings (id) ON DELETE SET NULL,
  chatId TEXT REFERENCES chats (id) ON DELETE SET NULL,
  -- waiting to be sent; skipped by the check, or because the check failed; or missed, being more
  -- than an hour late when the server could send it. Skipped and missed ones are kept a week.
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'skipped', 'missed')),
  -- How many times the check put it off
  delays INTEGER NOT NULL DEFAULT 0,
  -- Why it was skipped, missed or last delayed
  note TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX scheduledNotifications_sendAt ON scheduledNotifications (status, sendAt);
CREATE INDEX scheduledNotifications_userId ON scheduledNotifications (userId, status, sendAt);
