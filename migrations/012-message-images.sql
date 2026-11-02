-- user: the images attached to the message, as a JSON array of ids (data/images/<id>.jpg); null
-- when it has none. Generated images stay in imageId, on the tool message that made them.
ALTER TABLE chatMessages ADD COLUMN imageIds TEXT;
