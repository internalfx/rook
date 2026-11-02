-- Things the owner needs to get done. The chat model can add, find, change and complete them;
-- the owner manages them on the Tasks page, and only the owner can delete them.

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  -- The list sorts high first
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
  -- The day it's due, as YYYY-MM-DD in the owner's time zone; null when it has no due date
  dueDate TEXT,
  -- When it was marked done; null while it's still to do
  doneAt TEXT,
  -- The chat the model added it in; null when the owner added it, and kept when that chat is deleted
  chatId TEXT REFERENCES chats (id) ON DELETE SET NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX tasks_doneAt ON tasks (doneAt);
