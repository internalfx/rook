-- Runs of the chat model in the background, which look at memories and recent chats and suggest
-- things to talk about (see services/briefings.js)

CREATE TABLE briefings (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  -- What started it: the schedule in Settings, or the Brief me now button
  startedBy TEXT NOT NULL CHECK (startedBy IN ('schedule', 'manual')),
  -- The model's closing summary; null until it's done
  overview TEXT,
  -- Why it failed, shown on the page
  error TEXT,
  -- The tool calls it made, as a JSON array of { name, arguments, result }, for "What it did"
  steps TEXT NOT NULL DEFAULT '[]',
  startedAt TEXT NOT NULL,
  finishedAt TEXT
);

CREATE INDEX briefings_startedAt ON briefings (startedAt);

CREATE TABLE briefingSuggestions (
  id TEXT PRIMARY KEY,
  briefingId TEXT NOT NULL REFERENCES briefings (id) ON DELETE CASCADE,
  -- A few words, shown on the card and used as the chat's title
  title TEXT NOT NULL,
  -- What the model opens the conversation with
  message TEXT NOT NULL,
  -- The chat opened with Discuss; null until then, and again if that chat is deleted
  chatId TEXT REFERENCES chats (id) ON DELETE SET NULL,
  -- When it was first discussed, kept when the chat is deleted, so it doesn't count as new again
  discussedAt TEXT,
  dismissedAt TEXT,
  createdAt TEXT NOT NULL
);

CREATE INDEX briefingSuggestions_briefingId ON briefingSuggestions (briefingId);
