-- Facts the chat model, or the user, saved for every chat to use

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  -- The memory itself, in plain language
  content TEXT NOT NULL,
  -- 1: sent at the start of every chat. 0: found with search_memories when it's relevant
  pinned INTEGER NOT NULL DEFAULT 0,
  -- The chat it was saved in, if the model saved it; kept when that chat is deleted
  chatId TEXT REFERENCES chats (id) ON DELETE SET NULL,
  -- content as a vector of float32s; null until it's embedded (see lib/memories.js)
  embedding BLOB,
  -- The model that made `embedding`. Vectors from different models can't be compared, so a
  -- memory whose model isn't the one in Settings is embedded again before the next search.
  embeddingModel TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX memories_updatedAt ON memories (updatedAt);
