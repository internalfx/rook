import cuid from 'cuid'
import db from './db.js'
import { rankByMeaning } from './embeddings.js'

// Memories are facts kept for every chat. Pinned ones are sent at the start of every chat; the
// rest are found by meaning with search(). Writing a memory never calls Lemonade: its vector is
// made when it's next searched (see services/embeddings.js), so the memories page works while
// Lemonade is down.

const memoryColumns = `memories.id, memories.content, memories.pinned, memories.chatId, memories.createdAt, memories.updatedAt`

const selectMemories = db.query(`
  SELECT ${memoryColumns}, chats.title AS chatTitle
  FROM memories LEFT JOIN chats ON chats.id = memories.chatId
  ORDER BY memories.pinned DESC, memories.updatedAt DESC
`)
const selectMemory = db.query(`SELECT ${memoryColumns} FROM memories WHERE id = $id`)
const selectPinned = db.query(`SELECT ${memoryColumns} FROM memories WHERE pinned = 1 ORDER BY createdAt`)
const countPinnedRows = db.query(`SELECT COUNT(*) AS count FROM memories WHERE pinned = 1`)
const selectRecentSearchable = db.query(`
  SELECT ${memoryColumns} FROM memories WHERE pinned = 0 ORDER BY updatedAt DESC LIMIT $limit
`)
const selectSearchable = db.query(`
  SELECT ${memoryColumns}, memories.embedding, memories.embeddingModel
  FROM memories WHERE pinned = 0
`)
const insertMemory = db.query(`
  INSERT INTO memories (id, content, pinned, chatId, createdAt, updatedAt)
  VALUES ($id, $content, $pinned, $chatId, $now, $now)
`)
// A new text needs a new vector, so it's cleared until the next search
const updateMemoryRow = db.query(`
  UPDATE memories SET content = $content, pinned = $pinned, updatedAt = $now,
    embedding = CASE WHEN content = $content THEN embedding ELSE NULL END,
    embeddingModel = CASE WHEN content = $content THEN embeddingModel ELSE NULL END
  WHERE id = $id
`)
const updateEmbedding = db.query(`
  UPDATE memories SET embedding = $embedding, embeddingModel = $embeddingModel WHERE id = $id
`)
const deleteMemoryRow = db.query(`DELETE FROM memories WHERE id = $id`)

// SQLite has no booleans; pinned is stored as 1 or 0
const toMemory = function (row) {
  return { ...row, pinned: row.pinned === 1 }
}

// Every memory, pinned first, then the most recently changed; each has the title of the chat it
// was saved in (chatTitle), if any
export const listMemories = function () {
  const rows = selectMemories.all()
  return rows.map(toMemory)
}

export const getMemory = function (id) {
  const row = selectMemory.get({ id })

  if (row == null) {
    return null
  }

  return toMemory(row)
}

// The memories sent at the start of every chat, oldest first
export const listPinned = function () {
  const rows = selectPinned.all()
  return rows.map(toMemory)
}

export const countPinned = function () {
  const row = countPinnedRows.get()
  return row.count
}

// The searchable memories changed most recently, newest first, for briefings to look over
export const listRecent = function (limit) {
  const rows = selectRecentSearchable.all({ limit })
  return rows.map(toMemory)
}

// `chatId` is the chat it was saved in, or null when the user added it
export const createMemory = function ({ content, pinned = false, chatId = null }) {
  const id = cuid()
  const now = new Date().toISOString()

  insertMemory.run({ id, content, pinned: pinned ? 1 : 0, chatId, now })

  return getMemory(id)
}

// Returns the memory as it is now, or null when there's no memory with that id
export const updateMemory = function (id, { content, pinned }) {
  const now = new Date().toISOString()

  updateMemoryRow.run({ id, content, pinned: pinned ? 1 : 0, now })

  return getMemory(id)
}

export const deleteMemory = function (id) {
  deleteMemoryRow.run({ id })
}

// The searchable (not pinned) memories closest in meaning to `query`, closest first, each with
// its similarity as `score`. Memories without a vector from `model` (new, edited, unpinned, or
// made with another model) are embedded first, in the same request as the query.
export const search = async function ({ query, model, limit = 5, signal }) {
  const rows = selectSearchable.all()

  const ranked = await rankByMeaning({
    rows,
    query,
    model,
    signal,
    textOf: function (row) {
      return row.content
    },
    saveVector: function (row, embedding) {
      updateEmbedding.run({ id: row.id, embedding, embeddingModel: model })
    },
  })

  const closest = ranked.slice(0, limit).map(function ({ row, score }) {
    const { embedding, embeddingModel, ...memory } = row

    return { ...toMemory(memory), score }
  })

  return closest
}

export default {
  listMemories,
  getMemory,
  listPinned,
  countPinned,
  listRecent,
  createMemory,
  updateMemory,
  deleteMemory,
  search,
}
