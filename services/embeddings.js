import lemonade from './lemonade.js'

// Searching by meaning, shared by memories and tasks. Each searchable row stores its text as a
// vector (an `embedding` column of float32 bytes) and the model that made it (`embeddingModel`).
// Writing a row never calls Lemonade: a row whose vector is missing, or was made by another model
// (vectors from different models can't be compared), is embedded at its next search.

// A vector => the bytes stored in an embedding column, and back
export const encodeVector = function (vector) {
  const floats = new Float32Array(vector)
  return Buffer.from(floats.buffer)
}

export const decodeVector = function (bytes) {
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

// 1 when two vectors point the same way (the texts mean the same), down to -1
export const cosineSimilarity = function (a, b) {
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

// Ranks `rows` (each with id, embedding and embeddingModel) by how close their text is in meaning
// to `query`, closest first, as [{ row, score }]. Rows without a vector from `model` are embedded
// first, in the same request as the query; `textOf(row)` gives the text to embed, and
// `saveVector(row, bytes)` stores the new vector.
export const rankByMeaning = async function ({ rows, query, model, textOf, saveVector, signal }) {
  if (rows.length === 0) {
    return []
  }

  const stale = rows.filter(function (row) {
    return row.embedding == null || row.embeddingModel !== model
  })

  const staleTexts = stale.map(textOf)

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

    saveVector(row, encodeVector(vector))
    vectorsById[row.id] = vector
  })

  const ranked = rows.map(function (row) {
    const score = cosineSimilarity(queryVector, vectorsById[row.id])
    return { row, score }
  })

  ranked.sort(function (a, b) {
    return b.score - a.score
  })

  return ranked
}

export default {
  encodeVector,
  decodeVector,
  cosineSimilarity,
  rankByMeaning,
}
