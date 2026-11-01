
import crypto from 'node:crypto'
import lemonade from './lemonade.js'
import images from './images.js'
import settings from './settings.js'
import webReader from './webReader.js'
import webSearch from './webSearch.js'
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

// Each tool's definition, from its settings in a chat, or null when it can't be offered right now
const definitionsByName = {
  generate_image: () => generateImageTool,
  read_web_page: buildReadWebPageTool,
  web_search: buildWebSearchTool,
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

  const imageModel = settings.get(`imageModel`)

  if (imageModel != null) {
    const size = settings.get(`imageSize`) ?? defaultImageSize
    chatTools.generate_image = { model: imageModel, size }
  }

  // Offered only while Settings list some sites (see buildReadWebPageTool)
  chatTools.read_web_page = {}

  // Offered only while switched on in Settings (see buildWebSearchTool)
  chatTools.web_search = {}

  return chatTools
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

// One of the arguments the model gave a tool, or null when the arguments aren't valid JSON yet
const readArgument = function (argumentsText, key) {
  try {
    const args = JSON.parse(argumentsText)
    return args[key] ?? null
  } catch (err) {
    return null
  }
}

// The prompt the model gave generate_image
export const readImagePrompt = function (argumentsText) {
  return readArgument(argumentsText, `prompt`)
}

// The URL the model gave read_web_page
export const readToolUrl = function (argumentsText) {
  return readArgument(argumentsText, `url`)
}

// The query the model gave web_search
export const readSearchQuery = function (argumentsText) {
  return readArgument(argumentsText, `query`)
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
export const runTool = async function ({ name, argumentsText, chatTools, signal }) {
  const toolSettings = chatTools[name]

  // Only these tools are offered, so this catches a model inventing a name, or calling a tool
  // from earlier in the conversation that has since been turned off in Settings
  if (toolSettings == null) {
    return { content: `${name} is turned off in Settings.`, imageId: null }
  }

  try {
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
  readImagePrompt,
  readToolUrl,
  readSearchQuery,
  runTool,
}
