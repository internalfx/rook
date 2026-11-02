import settings from '../services/settings.js'
import webReader from './webReader.js'
import { extrasFor } from './sites.js'
import { readToolUrl } from './arguments.js'
import prompts from '../prompts.js'

// read_web_page: reads a page on one of the sites listed in Settings, as Markdown (see
// webReader.js and sites.js)

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
const maxPageChars = 40000

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

export const tools = [
  {
    name: `read_web_page`,
    // In every chat's tools, but offered only while Settings list some sites (see
    // buildReadWebPageTool)
    settings: () => ({}),
    definition: buildReadWebPageTool,
    run: runReadWebPage,
  },
]

export default {
  getWebDomains,
  isWebPagesOn,
  getReadableDomains,
  tools,
}
