import settings from '../services/settings.js'
import memories from '../services/memories.js'
import { parseArguments, readSearchQuery } from './arguments.js'
import prompts from '../prompts.js'

// save_memory, search_memories, update_memory and delete_memory: what the model remembers about
// the user (see services/memories.js). Pinned memories are given to it at the start of every chat
// (buildMemoriesMessage); the rest it searches for by meaning.

// The model memories are searched with; they can't be searched without one
export const getEmbeddingModel = function () {
  return settings.get(`embeddingModel`)
}

// Off until switched on in Settings, which needs an embedding model chosen
export const isMemoriesOn = function () {
  return settings.get(`memoriesOn`) === true && getEmbeddingModel() != null
}

// The descriptions are in prompts.js
const saveMemoryTool = {
  type: `function`,
  function: {
    name: `save_memory`,
    description: prompts.tools.save_memory.description,
    parameters: {
      type: `object`,
      properties: {
        content: {
          type: `string`,
          description: prompts.tools.save_memory.parameters.content,
        },
        pinned: {
          type: `boolean`,
          description: prompts.tools.save_memory.parameters.pinned,
        },
      },
      required: [`content`, `pinned`],
    },
  },
}

const searchMemoriesTool = {
  type: `function`,
  function: {
    name: `search_memories`,
    description: prompts.tools.search_memories.description,
    parameters: {
      type: `object`,
      properties: {
        query: {
          type: `string`,
          description: prompts.tools.search_memories.parameters.query,
        },
      },
      required: [`query`],
    },
  },
}

const updateMemoryTool = {
  type: `function`,
  function: {
    name: `update_memory`,
    description: prompts.tools.update_memory.description,
    parameters: {
      type: `object`,
      properties: {
        id: {
          type: `string`,
          description: prompts.tools.update_memory.parameters.id,
        },
        content: {
          type: `string`,
          description: prompts.tools.update_memory.parameters.content,
        },
        pinned: {
          type: `boolean`,
          description: prompts.tools.update_memory.parameters.pinned,
        },
      },
      required: [`id`],
    },
  },
}

const deleteMemoryTool = {
  type: `function`,
  function: {
    name: `delete_memory`,
    description: prompts.tools.delete_memory.description,
    parameters: {
      type: `object`,
      properties: {
        id: {
          type: `string`,
          description: prompts.tools.delete_memory.parameters.id,
        },
      },
      required: [`id`],
    },
  },
}

// The system message that starts every chat while memories are on: the pinned memories, with
// their ids so the model can change them. Null when there's nothing to send.
export const buildMemoriesMessage = function () {
  if (isMemoriesOn() === false) {
    return null
  }

  const pinned = memories.listPinned()

  if (pinned.length === 0) {
    return null
  }

  const lines = pinned.map(function (memory) {
    return `- [${memory.id}] ${memory.content}`
  })

  const content = prompts.memories.pinned({ list: lines.join(`\n`) })

  return { role: `system`, content }
}

const describeKind = function (pinned) {
  return pinned ? `pinned: given to you in every chat` : `searchable`
}

const runSaveMemory = function ({ argumentsText, chatId }) {
  const args = parseArguments(argumentsText) ?? {}
  const content = typeof args.content === `string` ? args.content.trim() : ``

  if (content === ``) {
    return { content: `Saving the memory failed: no content was given.`, imageId: null }
  }

  const memory = memories.createMemory({ content, pinned: args.pinned === true, chatId })

  return { content: `Saved memory [${memory.id}] (${describeKind(memory.pinned)}).`, imageId: null }
}

const runSearchMemories = async function ({ argumentsText, toolSettings, signal }) {
  const query = readSearchQuery(argumentsText)

  if (query == null || query.trim() === ``) {
    return { content: `The search failed: no query was given.`, imageId: null }
  }

  const results = await memories.search({ query: query.trim(), model: toolSettings.embeddingModel, signal })

  if (results.length === 0) {
    return { content: `There are no searchable memories saved yet.`, imageId: null }
  }

  const lines = results.map(function (memory, index) {
    return `${index + 1}. [${memory.id}] ${memory.content} (saved ${memory.createdAt.slice(0, 10)})`
  })

  return {
    content: `The memories closest to "${query.trim()}", closest first. Ignore any that aren't about it.\n\n${lines.join(`\n`)}`,
    imageId: null,
  }
}

const runUpdateMemory = function ({ argumentsText }) {
  const args = parseArguments(argumentsText) ?? {}
  const memory = typeof args.id === `string` ? memories.getMemory(args.id.trim()) : null

  if (memory == null) {
    return { content: `There's no memory with the id "${args.id}".`, imageId: null }
  }

  // Whatever the model leaves out stays as it is
  let content = memory.content
  let pinned = memory.pinned

  if (typeof args.content === `string` && args.content.trim() !== ``) {
    content = args.content.trim()
  }

  if (typeof args.pinned === `boolean`) {
    pinned = args.pinned
  }

  const updated = memories.updateMemory(memory.id, { content, pinned })

  return { content: `Updated memory [${updated.id}] (${describeKind(updated.pinned)}): ${updated.content}`, imageId: null }
}

const runDeleteMemory = function ({ argumentsText }) {
  const args = parseArguments(argumentsText) ?? {}
  const memory = typeof args.id === `string` ? memories.getMemory(args.id.trim()) : null

  if (memory == null) {
    return { content: `There's no memory with the id "${args.id}".`, imageId: null }
  }

  memories.deleteMemory(memory.id)

  return { content: `Deleted memory [${memory.id}]: ${memory.content}`, imageId: null }
}

// Offered only while memories are on
export const tools = [
  {
    name: `save_memory`,
    settings: () => (isMemoriesOn() ? {} : null),
    definition: () => saveMemoryTool,
    run: runSaveMemory,
  },
  {
    name: `search_memories`,
    settings: () => (isMemoriesOn() ? { embeddingModel: getEmbeddingModel() } : null),
    definition: () => searchMemoriesTool,
    run: runSearchMemories,
  },
  {
    name: `update_memory`,
    settings: () => (isMemoriesOn() ? {} : null),
    definition: () => updateMemoryTool,
    run: runUpdateMemory,
  },
  {
    name: `delete_memory`,
    settings: () => (isMemoriesOn() ? {} : null),
    definition: () => deleteMemoryTool,
    run: runDeleteMemory,
  },
]

export default {
  getEmbeddingModel,
  isMemoriesOn,
  buildMemoriesMessage,
  tools,
}
