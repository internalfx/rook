import cuid from 'cuid'
import prompts from '../prompts.js'
import db from './db.js'
import { rankByMeaning } from './embeddings.js'

// Memories are facts kept for every chat, each user's own (userId). Pinned ones are sent at the
// start of every chat; the rest are found by meaning with search(), and all of them by the
// Memories page's searchAll(). Writing a memory never calls Lemonade: its vector is made when
// it's next searched (see services/embeddings.js), so the memories page works while Lemonade is
// down.

const memoryColumns = `memories.id, memories.content, memories.pinned, memories.chatId, memories.createdAt, memories.updatedAt`

const selectMemories = db.query(`
  SELECT ${memoryColumns}, chats.title AS chatTitle
  FROM memories LEFT JOIN chats ON chats.id = memories.chatId
  WHERE memories.userId = $userId
  ORDER BY memories.pinned DESC, memories.updatedAt DESC
`)
const selectMemory = db.query(`SELECT ${memoryColumns} FROM memories WHERE id = $id AND userId = $userId`)
const selectPinned = db.query(`SELECT ${memoryColumns} FROM memories WHERE userId = $userId AND pinned = 1 ORDER BY createdAt`)
const countPinnedRows = db.query(`SELECT COUNT(*) AS count FROM memories WHERE userId = $userId AND pinned = 1`)
const selectRecentSearchable = db.query(`
  SELECT ${memoryColumns} FROM memories WHERE userId = $userId AND pinned = 0 ORDER BY updatedAt DESC LIMIT $limit
`)
const selectSearchable = db.query(`
  SELECT ${memoryColumns}, memories.embedding, memories.embeddingModel
  FROM memories WHERE userId = $userId AND pinned = 0
`)
// Every memory, pinned ones too, with the title of the chat it was saved in, for the Memories
// page's search
const selectAllForSearch = db.query(`
  SELECT ${memoryColumns}, chats.title AS chatTitle, memories.embedding, memories.embeddingModel
  FROM memories LEFT JOIN chats ON chats.id = memories.chatId
  WHERE memories.userId = $userId
`)
const insertMemory = db.query(`
  INSERT INTO memories (id, userId, content, pinned, chatId, createdAt, updatedAt)
  VALUES ($id, $userId, $content, $pinned, $chatId, $now, $now)
`)
// A new text needs a new vector, so it's cleared until the next search
const updateMemoryRow = db.query(`
  UPDATE memories SET content = $content, pinned = $pinned, updatedAt = $now,
    embedding = CASE WHEN content = $content THEN embedding ELSE NULL END,
    embeddingModel = CASE WHEN content = $content THEN embeddingModel ELSE NULL END
  WHERE id = $id AND userId = $userId
`)
const updateEmbedding = db.query(`
  UPDATE memories SET embedding = $embedding, embeddingModel = $embeddingModel WHERE id = $id
`)
const deleteMemoryRow = db.query(`DELETE FROM memories WHERE id = $id AND userId = $userId`)

// SQLite has no booleans; pinned is stored as 1 or 0
const toMemory = function (row) {
  return { ...row, pinned: row.pinned === 1 }
}

// Every memory, pinned first, then the most recently changed; each has the title of the chat it
// was saved in (chatTitle), if any
export const listMemories = function (userId) {
  const rows = selectMemories.all({ userId })
  return rows.map(toMemory)
}

// The user's memory with that id, or null: another user's reads as no memory
export const getMemory = function (userId, id) {
  const row = selectMemory.get({ userId, id })

  if (row == null) {
    return null
  }

  return toMemory(row)
}

// The memories sent at the start of every chat, oldest first
export const listPinned = function (userId) {
  const rows = selectPinned.all({ userId })
  return rows.map(toMemory)
}

export const countPinned = function (userId) {
  const row = countPinnedRows.get({ userId })
  return row.count
}

// The searchable memories changed most recently, newest first, for briefings to look over
export const listRecent = function (userId, limit) {
  const rows = selectRecentSearchable.all({ userId, limit })
  return rows.map(toMemory)
}

// `chatId` is the chat it was saved in, or null when the user added it
export const createMemory = function ({ userId, content, pinned = false, chatId = null }) {
  const id = cuid()
  const now = new Date().toISOString()

  insertMemory.run({ id, userId, content, pinned: pinned ? 1 : 0, chatId, now })

  return getMemory(userId, id)
}

// Returns the memory as it is now, or null when the user has no memory with that id
export const updateMemory = function (userId, id, { content, pinned }) {
  const now = new Date().toISOString()

  updateMemoryRow.run({ userId, id, content, pinned: pinned ? 1 : 0, now })

  return getMemory(userId, id)
}

export const deleteMemory = function (userId, id) {
  deleteMemoryRow.run({ userId, id })
}

// `rows` closest in meaning to `query`, closest first, up to `limit`, each with its similarity
// as `score`. Memories without a vector from `model` (new, edited, or made with another model)
// are embedded first, in the same request as the query, and their vectors saved.
const rankMemories = async function ({ rows, query, model, limit, signal }) {
  const ranked = await rankByMeaning({
    rows,
    query,
    instruction: prompts.embeddings.memories,
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

// The searchable (not pinned) memories closest in meaning to `query`, for the chat model, which
// has the pinned ones already
export const search = async function ({ userId, query, model, limit = 5, signal }) {
  const rows = selectSearchable.all({ userId })
  return rankMemories({ rows, query, model, limit, signal })
}

// Every memory, pinned ones too, closest in meaning to `query`, for the Memories page's search.
// Each has the title of the chat it was saved in (chatTitle), if any.
export const searchAll = async function ({ userId, query, model, limit, signal }) {
  const rows = selectAllForSearch.all({ userId })
  return rankMemories({ rows, query, model, limit, signal })
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
  searchAll,
}
