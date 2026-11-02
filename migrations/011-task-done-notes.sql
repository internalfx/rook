-- How a done task went, in a few words: what was done, anything left over, or why it no longer
-- applied. Optional; empty while it has none, and cleared when the task is put back on the list.
ALTER TABLE tasks ADD COLUMN doneNote TEXT NOT NULL DEFAULT '';
