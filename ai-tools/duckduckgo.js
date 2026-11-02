/* global HTMLRewriter */
// (HTMLRewriter is built into Bun)
import browser from './browser.js'
import { decodeEntities } from './webReader.js'

// Searches the web for the web_search tool, the way a metasearch engine like SearXNG does: open
// a search engine's results page and pick the results out of its HTML. The engine is DuckDuckGo's
// HTML-only page (html.duckduckgo.com), made for browsers without JavaScript, so it's complete
// as soon as it loads and its markup is simple. It's opened in the shared headless browser
// (see browser.js).
//
// If DuckDuckGo changes its markup, searches come back as refused (see parseResults); the
// classes it uses are in resultSelector and the handlers below.

const searchURL = `https://html.duckduckgo.com/html/`

const maxResults = 10

// Each result, ads aside, is a <div class="result results_links web-result"> holding a title
// link (a.result__a) and a snippet (.result__snippet)
const resultSelector = `div.web-result`

// The page DuckDuckGo shows when nothing matches
const noResultsSelector = `div.no-results`

// Result links go through DuckDuckGo's redirect, "//duckduckgo.com/l/?uddg=<the real URL>&rut=…";
// returns the real URL, or null for anything that isn't an http(s) page
const readResultURL = function (href) {
  if (href == null) {
    return null
  }

  let link

  try {
    link = new URL(decodeEntities(href), searchURL)
  } catch (err) {
    return null
  }

  const target = link.searchParams.get(`uddg`) ?? link.href

  try {
    const targetURL = new URL(target)
    const isWebPage = targetURL.protocol === `https:` || targetURL.protocol === `http:`
    return isWebPage ? targetURL.href : null
  } catch (err) {
    return null
  }
}

const cleanText = function (text) {
  return decodeEntities(text).replace(/\s+/g, ` `).trim()
}

// The results page's HTML => { results, hasNoResultsMessage }
const parseResults = async function (html) {
  const results = []
  let current = null
  let hasNoResultsMessage = false

  const rewriter = new HTMLRewriter()
    .on(resultSelector, {
      element (element) {
        const isAd = (element.getAttribute(`class`) ?? ``).includes(`result--ad`)

        current = isAd ? null : { title: ``, url: null, snippet: `` }

        if (current != null) {
          results.push(current)
        }
      },
    })
    .on(`${resultSelector} a.result__a`, {
      element (element) {
        if (current != null) {
          current.url = readResultURL(element.getAttribute(`href`))
        }
      },
      text (chunk) {
        if (current != null) {
          current.title += chunk.text
        }
      },
    })
    .on(`${resultSelector} .result__snippet`, {
      text (chunk) {
        if (current != null) {
          current.snippet += chunk.text
        }
      },
    })
    .on(noResultsSelector, {
      element () {
        hasNoResultsMessage = true
      },
    })

  await rewriter.transform(new Response(html)).text()

  const cleanResults = []

  for (const result of results) {
    if (result.url == null) {
      continue
    }

    cleanResults.push({ title: cleanText(result.title), url: result.url, snippet: cleanText(result.snippet) })
  }

  return { results: cleanResults, hasNoResultsMessage }
}

// Returns up to maxResults results as { title, url, snippet }, or none when nothing matched.
// Throws with a message for the model when DuckDuckGo won't answer.
export const search = async function ({ query, signal }) {
  const url = `${searchURL}?q=${encodeURIComponent(query)}`
  const page = await browser.loadPage({ url, signal })

  if (page.status >= 400 || page.html == null) {
    const status = `${page.status} ${page.statusText}`.trim()
    throw new Error(`DuckDuckGo refused the search (${status}). Try again in a while.`)
  }

  const { results, hasNoResultsMessage } = await parseResults(page.html)

  // Neither results nor its "no results" page: a captcha or error page instead
  if (results.length === 0 && hasNoResultsMessage === false) {
    throw new Error(`DuckDuckGo refused the search. Try again in a while.`)
  }

  return results.slice(0, maxResults)
}

export default {
  search,
}
