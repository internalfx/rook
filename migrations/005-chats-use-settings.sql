-- Every chat now uses the models and tools in Settings as they are right now, so chats no longer
-- keep their own (undoing 004-chat-config.sql). A conversation whose tools change part way has
-- its prompt reprocessed once by the server; that's accepted for Settings that apply everywhere.

ALTER TABLE chats DROP COLUMN model;
ALTER TABLE chats DROP COLUMN tools;
