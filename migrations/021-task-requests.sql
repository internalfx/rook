-- Tasks one user asks another to do (lib/taskRequests.js). A request is never a task itself:
-- the recipient's model looks at each one (services/requestReviews.js) and accepts it, which adds
-- a task to their list, declines it, or holds it for them to answer. Who may send to whom, and
-- each user's note about the others, are in userSettings under "people".
CREATE TABLE taskRequests (
  id TEXT PRIMARY KEY,
  -- Who asked, and who was asked. A request goes with either of them.
  fromUserId INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  toUserId INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The task as the sender wrote it; an accepted one's task starts as a copy
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
  -- YYYY-MM-DD, or null
  dueDate TEXT,
  -- reviewing: the recipient's model hasn't looked at it yet. waiting: held for the recipient to
  -- answer. Whether an accepted one is done is read from its task (tasks.requestId).
  status TEXT NOT NULL CHECK (status IN ('reviewing', 'waiting', 'accepted', 'declined')),
  -- Who accepted or declined it: the recipient, or their model. Null until someone has.
  answeredBy TEXT CHECK (answeredBy IN ('user', 'model')),
  -- Why: the model's reason for accepting, declining or holding it, which only the recipient is
  -- shown, or the recipient's own reason for declining, which the sender is shown
  answerNote TEXT NOT NULL DEFAULT '',
  answeredAt TEXT,
  -- When it was pushed to the recipient's phone, if it was; one sender's are an hour apart
  pushedAt TEXT,
  -- The sender's chat it was sent from; kept when that chat is deleted
  chatId TEXT REFERENCES chats (id) ON DELETE SET NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX taskRequests_toUserId ON taskRequests (toUserId, status);
CREATE INDEX taskRequests_fromUserId ON taskRequests (fromUserId, createdAt);
CREATE INDEX taskRequests_status ON taskRequests (status, createdAt);

-- The request a task was accepted from; null for the user's own tasks. When the sender's account
-- is deleted their requests go, and the tasks stay as the recipient's own.
ALTER TABLE tasks ADD COLUMN requestId TEXT REFERENCES taskRequests (id) ON DELETE SET NULL;

CREATE INDEX tasks_requestId ON tasks (requestId);
