import config from '../configure.js'
import lemonade from '../services/lemonade.js'
import webReader from './webReader.js'
import { extrasFor } from './sites.js'
import { readToolUrl } from './arguments.js'
import prompts from '../prompts.js'

// read_web_page: reads a page on one of the sites listed in config.js, as Markdown (see
// webReader.js and sites.js)

// The sites listed in config.js, for every chat, whether web pages are on or off
export const getWebDomains = function () {
  return config.tools?.webDomains ?? []
}

// Web pages are on unless switched off in config.js, where the list of sites stays for when
// they're switched back on
export const isWebPagesOn = function () {
  return config.tools?.webPages !== false
}

// The MinerU-HTML model that picks out pages' main content (see webReader.readPage), or null to
// convert them directly. A model named that isn't one (a page reader rook no longer uses) counts
// as none.
export const getPageReaderModel = function () {
  const model = config.models?.pageReader ?? null
  return model != null && lemonade.isPageReaderModel({ id: model }) ? model : null
}

// The sites read_web_page may read right now: none while web pages are switched off
export const getReadableDomains = function () {
  if (isWebPagesOn() === false) {
    return []
  }

  return getWebDomains()
}

// read_web_page's definition names the sites it can read, as they are in config.js
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
      description: prompts.tools.read_web_page.description({ sites: siteList.join(`; `) }),
      parameters: {
        type: `object`,
        properties: {
          url: {
            type: `string`,
            description: prompts.tools.read_web_page.parameters.url,
          },
        },
        required: [`url`],
      },
    },
  }
}

// The longest page read_web_page hands the chat model
const maxPageChars = 50000

// How the page reader did, for the line under the page's URL (also seen in the tool's row in
// the chat), or null when there's none
const describeReader = function (reader) {
  if (reader == null) {
    return null
  }

  if (reader.failed != null) {
    return `${reader.model} couldn't read it (${reader.failed}), so it was converted directly.`
  }

  const unfinished = reader.isUnfinished ? ` (it stopped before labelling them all)` : ``
  return `Read with ${reader.model} in ${reader.seconds} s: kept ${reader.kept} of ${reader.total} blocks${unfinished}.`
}

// Downloads the page as Markdown (or the text file as it is)
const runReadWebPage = async function ({ argumentsText, toolSettings, signal }) {
  const url = readToolUrl(argumentsText)

  if (url == null || url.trim() === ``) {
    return { content: `Reading the page failed: no URL was given.`, imageId: null }
  }

  const domains = getReadableDomains()

  // Web pages can be switched off, or the list emptied, in config.js part way through a conversation
  if (domains.length === 0) {
    return { content: `Reading web pages is turned off in config.js.`, imageId: null }
  }

  const page = await webReader.readPage({ url: url.trim(), domains, readerModel: toolSettings.pageReaderModel, signal })

  let body = page.markdown ?? page.text

  if (body.length > maxPageChars) {
    body = `${body.slice(0, maxPageChars)}\n\n[Cut off here: the page is longer than ${maxPageChars} characters.]`
  }

  const readerLine = describeReader(page.reader)
  const heading = readerLine == null ? `Page: ${page.url}` : `Page: ${page.url}\n${readerLine}`

  return { content: `${heading}\n\n${body}`, imageId: null }
}

export const tools = [
  {
    name: `read_web_page`,
    // In every chat's tools, but offered only while config.js lists some sites (see
    // buildReadWebPageTool). The page reader is as config.js had it when the message started.
    settings: () => ({ pageReaderModel: getPageReaderModel() }),
    definition: buildReadWebPageTool,
    run: runReadWebPage,
  },
]

export default {
  getWebDomains,
  isWebPagesOn,
  getPageReaderModel,
  getReadableDomains,
  tools,
}
