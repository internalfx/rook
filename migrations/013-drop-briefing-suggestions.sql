-- Briefings no longer make suggestions: Discuss on a briefing opens a chat with its overview
-- (see routes/briefing/[id]/discuss.js). Chats already opened from a suggestion are kept.

DROP TABLE briefingSuggestions;

-- Their add_suggestion calls are taken out of each briefing's "What it did"
UPDATE briefings
SET steps = (
  SELECT json_group_array(json(value))
  FROM json_each(briefings.steps)
  WHERE json_extract(value, '$.name') IS NOT 'add_suggestion'
)
WHERE EXISTS (
  SELECT 1 FROM json_each(briefings.steps) WHERE json_extract(value, '$.name') = 'add_suggestion'
);
