-- Tool use: an assistant message can ask for tools, and each result is stored as a 'tool' message.
-- SQLite can't change a CHECK constraint in place, so chatMessages is rebuilt with the new columns.

CREATE TABLE chatMessagesNew (
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
  -- tool: the image it produced (data/images/<imageId>.png), if any
  imageId TEXT,
  createdAt TEXT NOT NULL
);

INSERT INTO chatMessagesNew (id, chatId, role, content, reasoning, createdAt)
SELECT id, chatId, role, content, reasoning, createdAt FROM chatMessages;

DROP TABLE chatMessages;

ALTER TABLE chatMessagesNew RENAME TO chatMessages;

CREATE INDEX chatMessages_chatId ON chatMessages (chatId);
