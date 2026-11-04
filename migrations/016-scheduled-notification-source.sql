-- Where a scheduled notification was scheduled: in a chat, or by a briefing. Old briefings are
-- soon deleted, which clears briefingId, so this is kept apart from the ids.

ALTER TABLE scheduledNotifications ADD COLUMN source TEXT NOT NULL DEFAULT 'chat' CHECK (source IN ('chat', 'briefing'));
