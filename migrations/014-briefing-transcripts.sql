-- A briefing is watched like a chat reply (see services/briefings.js), and keeps what it did as
-- a transcript in the chat page's own form: its replies, with their thinking, and each tool call
-- with its result. This replaces steps, which only had the tool calls. Older briefings are
-- deleted after a few more, so their steps aren't carried over.

ALTER TABLE briefings ADD COLUMN transcript TEXT NOT NULL DEFAULT '[]';

ALTER TABLE briefings DROP COLUMN steps;
