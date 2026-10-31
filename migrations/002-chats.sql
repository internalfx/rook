-- Conversations with the Lemonade server

CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  -- Written by the model after the first reply; null until then
  title TEXT,
  -- The model last used in this chat, selected again when the chat is reopened
  model TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX chats_updatedAt ON chats (updatedAt);

CREATE TABLE chatMessages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chatId TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  -- A thinking model's reasoning, kept separate from its answer
  reasoning TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE INDEX chatMessages_chatId ON chatMessages (chatId);
