-- Tasks can be found by meaning too (find_tasks in ai-tools/tasks.js), with the embedding model
-- memories use. As for memories, the vector is made at the next search after a task is added or
-- its title or notes change (see lib/embeddings.js).

-- The title and notes as a vector of float32s; null until it's embedded
ALTER TABLE tasks ADD COLUMN embedding BLOB;
-- The model that made `embedding`; a task embedded by another model is embedded again
ALTER TABLE tasks ADD COLUMN embeddingModel TEXT;
