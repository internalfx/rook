import config from '../configure.js'
import duckduckgo from './duckduckgo.js'
import { matchDomain } from './sites.js'
import { getReadableDomains } from './webPages.js'
import { readSearchQuery } from './arguments.js'
import prompts from '../lib/prompts.js'

// web_search: searches DuckDuckGo (see duckduckgo.js), and marks the results read_web_page can
// open

// Off until switched on in config.js, since it sends the model's searches to DuckDuckGo
export const isWebSearchOn = function () {
  return config.tools?.webSearch === true
}

// The same text whatever the Sites list holds, so editing the list doesn't change it; each
// result says whether read_web_page can open it
const webSearchTool = {
  type: `function`,
  function: {
    name: `web_search`,
    description: prompts.tools.web_search.description,
    parameters: {
      type: `object`,
      properties: {
        query: {
          type: `string`,
          description: prompts.tools.web_search.parameters.query,
        },
      },
      required: [`query`],
    },
  },
}

const buildWebSearchTool = function () {
  return isWebSearchOn() ? webSearchTool : null
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

  // It can be switched off in config.js part way through a conversation
  if (isWebSearchOn() === false) {
    return { content: `Web search is turned off in config.js.`, imageId: null }
  }

  const results = await duckduckgo.search({ query: query.trim(), signal })

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

export const tools = [
  {
    name: `web_search`,
    // In every chat's tools, but offered only while switched on in config.js (see
    // buildWebSearchTool)
    settings: () => ({}),
    definition: buildWebSearchTool,
    run: runWebSearch,
  },
]

export default {
  isWebSearchOn,
  tools,
}
