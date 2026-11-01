
import crypto from 'node:crypto'
import lemonade from './lemonade.js'
import images from './images.js'
import settings from './settings.js'
import webReader from './webReader.js'
import webSearch from './webSearch.js'
import memories from './memories.js'
import { extrasFor, matchDomain } from './sites.js'

// Tools the chat model can call, as OpenAI-style function definitions. Every chat has the tools
// Settings give right now, as an object keyed by tool name ("chat tools", see getChatTools):
//   { generate_image: { model: `SDXL-Turbo`, size: `512x512` }, read_web_page: {} }

const generateImageTool = {
  type: `function`,
  function: {
    name: `generate_image`,
    description: `Create an image from a text description and show it to the user. Use it whenever the user asks for a picture, drawing, illustration, photo, logo or any other image.`,
    parameters: {
      type: `object`,
      properties: {
        prompt: {
          type: `string`,
          description: `A detailed description of the image, in English: the subject, setting, style, colours and composition.`,
        },
      },
      required: [`prompt`],
    },
  },
}

// The sites listed in Settings, for every chat, whether web pages are on or off
export const getWebDomains = function () {
  return settings.get(`webDomains`) ?? []
}

// Web pages are on unless switched off in Settings. Off is saved as its own setting, so the
// list of sites is kept for when they're switched back on.
export const isWebPagesOn = function () {
  return settings.get(`webPagesOff`) !== true
}

// The sites read_web_page may read right now: none while web pages are switched off
export const getReadableDomains = function () {
  if (isWebPagesOn() === false) {
    return []
  }

  return getWebDomains()
}

// read_web_page's definition names the sites it can read, as they are in Settings right now
const buildReadWebPageTool = function () {
  const domains = getReadableDomains()

  if (domains.length === 0) {
    return null
  }

  const siteList = domains.map(function (domain) {
    const contents = extrasFor(domain).contents
    return contents == null ? domain : `${domain} (${contents})`
  })

  return {
    type: `function`,
    function: {
      name: `read_web_page`,
      description: `Read a web page and get its content as Markdown. You can read pages on these sites, and their subdomains: ${siteList.join(`; `)}. Use it whenever the user asks about something on these sites, and follow the URLs in what it returns to look further.`,
      parameters: {
        type: `object`,
        properties: {
          url: {
            type: `string`,
            description: `The full URL of the page to read.`,
          },
        },
        required: [`url`],
      },
    },
  }
}

// Off until switched on in Settings, since it sends the model's searches to DuckDuckGo
export const isWebSearchOn = function () {
  return settings.get(`webSearchOn`) === true
}

// The same text whatever the Sites list holds, so editing the list doesn't change it; each
// result says whether read_web_page can open it
const webSearchTool = {
  type: `function`,
  function: {
    name: `web_search`,
    description: `Search the web with DuckDuckGo and get the top results: each one's title, link and a short snippet. Use it to find pages or facts you don't know, including recent ones. Add site:example.com to the query to search one site. Results marked (readable) can be opened with read_web_page; the others can't be opened, so answer from their snippets.`,
    parameters: {
      type: `object`,
      properties: {
        query: {
          type: `string`,
          description: `What to search for, as you'd type it into a search engine.`,
        },
      },
      required: [`query`],
    },
  },
}

const buildWebSearchTool = function () {
  return isWebSearchOn() ? webSearchTool : null
}

// The model memories are searched with; they can't be searched without one
export const getEmbeddingModel = function () {
  return settings.get(`embeddingModel`)
}

// Off until switched on in Settings, which needs an embedding model chosen
export const isMemoriesOn = function () {
  return settings.get(`memoriesOn`) === true && getEmbeddingModel() != null
}

const pinnedDescription = `true only for things that matter in almost every conversation, like the user's name or how they like answers written; those are given to you at the start of every chat. false for everything else, which you find with search_memories when it's relevant.`

const saveMemoryTool = {
  type: `function`,
  function: {
    name: `save_memory`,
    description: `Save a memory: something about the user, or something they asked you to remember, kept for every future chat. Save one when the user tells you something worth knowing later (their name, family, pets, work, likes, plans) or asks you to remember something. If you already have a memory about it, change that one with update_memory instead of saving another.`,
    parameters: {
      type: `object`,
      properties: {
        content: {
          type: `string`,
          description: `The memory as one short sentence that makes sense on its own, e.g. "The user's dog is called Biscuit."`,
        },
        pinned: {
          type: `boolean`,
          description: pinnedDescription,
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
    description: `Search your saved memories by meaning, for things the user told you in earlier chats. Use it whenever the user mentions something you might have been told before, or asks what you remember, before saying you don't know. Pinned memories aren't searched; they're already given to you at the start of the chat.`,
    parameters: {
      type: `object`,
      properties: {
        query: {
          type: `string`,
          description: `What to look for, in a few words, e.g. "the user's dog".`,
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
    description: `Change a saved memory, when the user corrects it or it's out of date. Give its id (from search_memories, or the pinned list at the start of the chat) and whatever changes.`,
    parameters: {
      type: `object`,
      properties: {
        id: {
          type: `string`,
          description: `The memory's id.`,
        },
        content: {
          type: `string`,
          description: `The memory's new text, as one short sentence. Leave it out to keep the text.`,
        },
        pinned: {
          type: `boolean`,
          description: `${pinnedDescription} Leave it out to keep it as it is.`,
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
    description: `Delete a saved memory, when the user asks you to forget it or it's no longer true. Give its id (from search_memories, or the pinned list at the start of the chat).`,
    parameters: {
      type: `object`,
      properties: {
        id: {
          type: `string`,
          description: `The memory's id.`,
        },
      },
      required: [`id`],
    },
  },
}

// Models only know the date their training ended, so they're given a way to ask
const currentTimeTool = {
  type: `function`,
  function: {
    name: `get_current_time`,
    description: `Get the current date, time and time zone. Use it whenever the answer depends on today's date or the time: "today", "tomorrow" or "this week", how long until or since something, someone's age, or whether something has happened yet.`,
    parameters: {
      type: `object`,
      properties: {},
    },
  },
}

// Each tool's definition, from its settings in a chat, or null when it can't be offered right now
const definitionsByName = {
  get_current_time: () => currentTimeTool,
  generate_image: () => generateImageTool,
  read_web_page: buildReadWebPageTool,
  web_search: buildWebSearchTool,
  save_memory: () => saveMemoryTool,
  search_memories: () => searchMemoriesTool,
  update_memory: () => updateMemoryTool,
  delete_memory: () => deleteMemoryTool,
}

// The longest page read_web_page hands the chat model
const maxPageChars = 40000

// The image size choices in Settings, from small to large ("WIDTHxHEIGHT")
export const imageSizes = [`256x256`, `512x512`, `768x768`]

// Used until a size is chosen in Settings; it's what the image models produce by default
export const defaultImageSize = `512x512`

// The tools every chat has right now, and their settings, from Settings
export const getChatTools = function () {
  const chatTools = {}

  // Always offered; it has nothing to set up
  chatTools.get_current_time = {}

  const imageModel = settings.get(`imageModel`)

  if (imageModel != null) {
    const size = settings.get(`imageSize`) ?? defaultImageSize
    chatTools.generate_image = { model: imageModel, size }
  }

  // Offered only while Settings list some sites (see buildReadWebPageTool)
  chatTools.read_web_page = {}

  // Offered only while switched on in Settings (see buildWebSearchTool)
  chatTools.web_search = {}

  if (isMemoriesOn()) {
    chatTools.save_memory = {}
    chatTools.search_memories = { embeddingModel: getEmbeddingModel() }
    chatTools.update_memory = {}
    chatTools.delete_memory = {}
  }

  return chatTools
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

  const content = `Things you remember about the user (your pinned memories; the id in brackets is for update_memory and delete_memory):\n${lines.join(`\n`)}`

  return { role: `system`, content }
}

// The definitions to offer the model for a chat's tools
export const getToolDefinitions = function (chatTools) {
  const definitions = []

  for (const [name, toolSettings] of Object.entries(chatTools)) {
    const buildDefinition = definitionsByName[name]
    const definition = buildDefinition == null ? null : buildDefinition(toolSettings)

    if (definition != null) {
      definitions.push(definition)
    }
  }

  return definitions
}

// The arguments the model gave a tool, as an object, or null when they aren't valid JSON yet
const parseArguments = function (argumentsText) {
  try {
    return JSON.parse(argumentsText)
  } catch (err) {
    return null
  }
}

// One of the arguments the model gave a tool, or null when the arguments aren't valid JSON yet
const readArgument = function (argumentsText, key) {
  const args = parseArguments(argumentsText)
  return args?.[key] ?? null
}

// The prompt the model gave generate_image
export const readImagePrompt = function (argumentsText) {
  return readArgument(argumentsText, `prompt`)
}

// The URL the model gave read_web_page
export const readToolUrl = function (argumentsText) {
  return readArgument(argumentsText, `url`)
}

// The query the model gave web_search or search_memories
export const readSearchQuery = function (argumentsText) {
  return readArgument(argumentsText, `query`)
}

// The text the model gave save_memory or update_memory
export const readMemoryContent = function (argumentsText) {
  return readArgument(argumentsText, `content`)
}

const describeKind = function (pinned) {
  return pinned ? `pinned: given to you in every chat` : `searchable`
}

// In the server's time zone, which is the owner's, written out so the model can't misread it,
// with the ISO form for working things out
const runGetCurrentTime = function () {
  const now = new Date()
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const localTime = now.toLocaleString(`en-US`, { dateStyle: `full`, timeStyle: `long`, timeZone })

  return { content: `It's ${localTime} (time zone ${timeZone}). In UTC: ${now.toISOString()}`, imageId: null }
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

const runGenerateImage = async function ({ argumentsText, toolSettings, signal }) {
  const prompt = readImagePrompt(argumentsText)

  if (prompt == null || prompt.trim() === ``) {
    return { content: `Image generation failed: no prompt was given.`, imageId: null }
  }

  // A new seed each time, so asking again gives a different image. Without a size, the model
  // uses its own default.
  const seed = crypto.randomInt(0, 2147483647)
  const size = toolSettings.size ?? null

  const pngBuffer = await lemonade.generateImage({ model: toolSettings.model, prompt, size, seed, signal })
  const imageId = await images.saveImage(pngBuffer)

  return {
    content: `The image was created and is already shown to the user. Don't include a link or markdown image for it in your reply.`,
    imageId,
  }
}

// Downloads the page as Markdown (or the text file as it is)
const runReadWebPage = async function ({ argumentsText, signal }) {
  const url = readToolUrl(argumentsText)

  if (url == null || url.trim() === ``) {
    return { content: `Reading the page failed: no URL was given.`, imageId: null }
  }

  const domains = getReadableDomains()

  // Web pages can be switched off, or the list emptied, in Settings part way through a conversation
  if (domains.length === 0) {
    return { content: `Reading web pages is turned off in Settings.`, imageId: null }
  }

  const page = await webReader.readPage({ url: url.trim(), domains, signal })

  let body = page.markdown ?? page.text

  if (body.length > maxPageChars) {
    body = `${body.slice(0, maxPageChars)}\n\n[Cut off here: the page is longer than ${maxPageChars} characters.]`
  }

  return { content: `Page: ${page.url}\n\n${body}`, imageId: null }
}

// Whether read_web_page can open `url` right now
const isReadable = function (url) {
  const hostname = new URL(url).hostname
  return matchDomain(hostname, getReadableDomains()) != null
}

// The results as a numbered Markdown list, each marked (readable) when read_web_page can open it
const runWebSearch = async function ({ argumentsText, signal }) {
  const query = readSearchQuery(argumentsText)

  if (query == null || query.trim() === ``) {
    return { content: `The search failed: no query was given.`, imageId: null }
  }

  // It can be switched off in Settings part way through a conversation
  if (isWebSearchOn() === false) {
    return { content: `Web search is turned off in Settings.`, imageId: null }
  }

  const results = await webSearch.search({ query: query.trim(), signal })

  if (results.length === 0) {
    return { content: `No results for "${query.trim()}".`, imageId: null }
  }

  const lines = results.map(function (result, index) {
    const readable = isReadable(result.url) ? ` (readable)` : ``
    const snippet = result.snippet === `` ? `` : `\n   ${result.snippet}`

    return `${index + 1}. [${result.title}](${result.url})${readable}${snippet}`
  })

  return { content: `Results for "${query.trim()}":\n\n${lines.join(`\n`)}`, imageId: null }
}

// Runs one tool call and returns { content, imageId }. `content` is what the model is told
// about the result. Failures are reported to the model as text rather than thrown, so it can
// explain them to the user; a stopped call still throws, so the caller can tell it was stopped.
// `chatId` is the chat the call was made in.
export const runTool = async function ({ name, argumentsText, chatTools, chatId, signal }) {
  const toolSettings = chatTools[name]

  // Only these tools are offered, so this catches a model inventing a name, or calling a tool
  // from earlier in the conversation that has since been turned off in Settings
  if (toolSettings == null) {
    return { content: `${name} is turned off in Settings.`, imageId: null }
  }

  try {
    if (name === `get_current_time`) {
      const result = runGetCurrentTime()
      return result
    }

    if (name === `generate_image`) {
      const result = await runGenerateImage({ argumentsText, toolSettings, signal })
      return result
    }

    if (name === `read_web_page`) {
      const result = await runReadWebPage({ argumentsText, signal })
      return result
    }

    if (name === `web_search`) {
      const result = await runWebSearch({ argumentsText, signal })
      return result
    }

    if (name === `save_memory`) {
      const result = runSaveMemory({ argumentsText, chatId })
      return result
    }

    if (name === `search_memories`) {
      const result = await runSearchMemories({ argumentsText, toolSettings, signal })
      return result
    }

    if (name === `update_memory`) {
      const result = runUpdateMemory({ argumentsText })
      return result
    }

    if (name === `delete_memory`) {
      const result = runDeleteMemory({ argumentsText })
      return result
    }

    return { content: `There is no tool named "${name}".`, imageId: null }
  } catch (err) {
    if (signal.aborted === true) {
      throw err
    }

    console.error(`Tool ${name} failed`, err)
    return { content: `${name} failed: ${err.message}`, imageId: null }
  }
}

export default {
  imageSizes,
  defaultImageSize,
  getChatTools,
  getToolDefinitions,
  getWebDomains,
  isWebPagesOn,
  getReadableDomains,
  isWebSearchOn,
  getEmbeddingModel,
  isMemoriesOn,
  buildMemoriesMessage,
  readImagePrompt,
  readToolUrl,
  readSearchQuery,
  readMemoryContent,
  runTool,
}
