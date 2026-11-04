-- Notifications the model scheduled for later, in a chat or a briefing. Just before each is due,
-- the model checks it's still right and sends it, delays it or skips it (see
-- services/notificationChecks.js). One that's sent is deleted from here: it's in notifications.

CREATE TABLE scheduledNotifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  -- When to send it, as an ISO date; moved later when the check delays it
  sendAt TEXT NOT NULL,
  -- What the model that scheduled it wants checked before it goes out; may be empty
  checkNote TEXT NOT NULL DEFAULT '',
  -- Where it was scheduled; kept when that briefing or chat is deleted
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
