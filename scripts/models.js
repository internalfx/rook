
// Lists the models on the Lemonade server, by kind, for naming them in config.js (models.chat,
// models.image, models.embedding and models.pageReader)
//   bun scripts/models.js

import config from '../configure.js'
import lemonade from '../services/lemonade.js'
import { formatContextLength } from '../lib/format.js'

let models = []

try {
  models = await lemonade.listModels()
} catch (err) {
  console.error(`Couldn't list the models on the Lemonade server at ${config.lemonade.host}: ${err.message}`)
  process.exit(1)
}

// A model as one line: its name, then its labels, size and context length
const describe = function (model) {
  const details = [...(model.labels ?? [])]

  if (model.size != null) {
    details.push(`${model.size} GB`)
  }

  const contextLength = formatContextLength(model.context_length)

  if (contextLength != null) {
    details.push(`${contextLength} context`)
  }

  return `  ${model.id}${details.length > 0 ? `  (${details.join(`, `)})` : ``}`
}

const kinds = [
  {
    title: `Chat models (models.chat)`,
    matches: (model) => lemonade.hasLabel(model, `chat`) && lemonade.isPageReaderModel(model) === false,
  },
  {
    title: `Image models (models.image)`,
    matches: (model) => lemonade.hasLabel(model, `image`),
  },
  {
    title: `Embedding models (models.embedding)`,
    matches: (model) => lemonade.hasLabel(model, `embeddings`),
  },
  {
    title: `Page readers (models.pageReader)`,
    matches: (model) => lemonade.isPageReaderModel(model),
  },
]

for (const kind of kinds) {
  const listed = models.filter(kind.matches)

  console.log(``)
  console.log(kind.title)

  if (listed.length === 0) {
    console.log(`  (none)`)
    continue
  }

  for (const model of listed) {
    console.log(describe(model))
  }
}

console.log(``)
