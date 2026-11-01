import cuid from 'cuid'
import db from './db.js'
import lemonade from './lemonade.js'

// Memories are facts kept for every chat. Pinned ones are sent at the start of every chat; the
// rest are found by meaning with search(). Writing a memory never calls Lemonade: its vector is
// made when it's next searched (see search), so the memories page works while Lemonade is down.

const memoryColumns = `memories.id, memories.content, memories.pinned, memories.chatId, memories.createdAt, memories.updatedAt`

const selectMemories = db.query(`
  SELECT ${memoryColumns}, chats.title AS chatTitle
  FROM memories LEFT JOIN chats ON chats.id = memories.chatId
  ORDER BY memories.pinned DESC, memories.updatedAt DESC
`)
const selectMemory = db.query(`SELECT ${memoryColumns} FROM memories WHERE id = $id`)
const selectPinned = db.query(`SELECT ${memoryColumns} FROM memories WHERE pinned = 1 ORDER BY createdAt`)
const countPinnedRows = db.query(`SELECT COUNT(*) AS count FROM memories WHERE pinned = 1`)
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

// A vector => the bytes stored in memories.embedding, and back
const encodeVector = function (vector) {
  const floats = new Float32Array(vector)
  return Buffer.from(floats.buffer)
}

const decodeVector = function (bytes) {
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

// 1 when two vectors point the same way (the texts mean the same), down to -1
const cosineSimilarity = function (a, b) {
  let dot = 0
  let lengthA = 0
  let lengthB = 0

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    lengthA += a[i] * a[i]
    lengthB += b[i] * b[i]
  }

  if (lengthA === 0 || lengthB === 0) {
    return 0
  }

  return dot / (Math.sqrt(lengthA) * Math.sqrt(lengthB))
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

  if (rows.length === 0) {
    return []
  }

  const stale = rows.filter(function (row) {
    return row.embedding == null || row.embeddingModel !== model
  })

  const staleTexts = stale.map(function (row) {
    return row.content
  })

  const vectors = await lemonade.embed({ model, inputs: [query, ...staleTexts], signal })
  const queryVector = vectors[0]

  const vectorsById = {}

  for (const row of rows) {
    if (row.embedding != null && row.embeddingModel === model) {
      vectorsById[row.id] = decodeVector(row.embedding)
    }
  }

  stale.forEach(function (row, index) {
    const vector = vectors[index + 1]

    updateEmbedding.run({ id: row.id, embedding: encodeVector(vector), embeddingModel: model })
    vectorsById[row.id] = vector
  })

  const scored = rows.map(function (row) {
    const score = cosineSimilarity(queryVector, vectorsById[row.id])
    const { embedding, embeddingModel, ...memory } = row

    return { ...toMemory(memory), score }
  })

  scored.sort(function (a, b) {
    return b.score - a.score
  })

  return scored.slice(0, limit)
}

export default {
  listMemories,
  getMemory,
  listPinned,
  countPinned,
  createMemory,
  updateMemory,
  deleteMemory,
  search,
}
