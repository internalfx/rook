/* global HTMLRewriter */
// (HTMLRewriter is built into Bun)
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import browser from './browser.js'
import mainContent from './mainContent.js'
import { matchDomain, extrasFor, describeDomains } from './sites.js'

// Loads web pages for the read_web_page tool (in a headless browser, see browser.js) and turns
// them into Markdown. Pages are mostly scripts, styles and embedded data (GitHub's run from a
// few hundred KB to over a megabyte); those, and every attribute but links, are removed first,
// then what's left is converted, which takes milliseconds. With a page reader named in config.js
// (a MinerU-HTML model), the model first picks out the page's main content to convert, which
// takes a few seconds, and images are kept too (mainContent.js).

// Elements with nothing to read in them, on any site, including the page's own banner and
// footer (matched by role, since page content can sit in a <header> or <footer> too)
const removedElements = [
  `head`, `script`, `style`, `svg`, `noscript`, `template`, `link`, `meta`, `iframe`, `img`,
  `header[role="banner"]`, `footer[role="contentinfo"]`,
]

// Wrappers left empty once their contents are removed
const emptyElementPattern = /<(div|p|li|ul|ol|section|nav|button|a)>\s*<\/\1>/g

const namedEntities = {
  amp: `&`,
  lt: `<`,
  gt: `>`,
  quot: `"`,
  apos: `'`,
  nbsp: ` `,
}

// Attribute values come back from HTMLRewriter still encoded ("&amp;")
export const decodeEntities = function (text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (match, name) {
    if (name[0] === `#`) {
      const isHex = name[1] === `x` || name[1] === `X`
      const code = isHex ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)

      try {
        return String.fromCodePoint(code)
      } catch (err) {
        return match
      }
    }

    return namedEntities[name.toLowerCase()] ?? match
  })
}

// A link's href => the absolute URL to keep, or null to drop it. Links to other sites are kept
// too; links to the listed sites lose each site's skipped paths, and links back to the page
// itself are dropped.
const linkTarget = function ({ href, pageURL, domains }) {
  if (href == null || href.startsWith(`#`) || href.startsWith(`javascript:`)) {
    return null
  }

  let target

  try {
    target = new URL(decodeEntities(href), pageURL)
  } catch (err) {
    return null
  }

  if (target.protocol !== `https:` && target.protocol !== `http:`) {
    return null
  }

  const domain = matchDomain(target.hostname, domains)
  let isSkipped = false

  if (domain != null) {
    const skipLinkPaths = extrasFor(domain).skipLinkPaths ?? []

    isSkipped = target.pathname === `/` || skipLinkPaths.some(function (path) {
      return target.pathname === path || target.pathname.startsWith(`${path}/`)
    })
  }

  target.hash = ``

  if (isSkipped || target.href === pageURL) {
    return null
  }

  return target.href
}

// An image's src => its absolute URL, or null for one embedded in the page (a data: URI) or
// missing
const imageSource = function ({ src, pageURL }) {
  if (src == null) {
    return null
  }

  let source

  try {
    source = new URL(decodeEntities(src), pageURL)
  } catch (err) {
    return null
  }

  const isWebImage = source.protocol === `https:` || source.protocol === `http:`
  return isWebImage ? source.href : null
}

// Collapses the whitespace between tags, except inside <pre> and <textarea>, where code keeps
// its line breaks and indentation
const collapseWhitespace = function (html) {
  const parts = html.split(/(<(pre|textarea)>[\s\S]*?<\/\2>)/)
  const result = []

  for (let index = 0; index < parts.length; index += 3) {
    result.push(parts[index].replace(/\s+/g, ` `))

    // split() puts each match, then its tag name, after the text before it
    if (parts[index + 1] != null) {
      result.push(parts[index + 1])
    }
  }

  return result.join(``)
}

// Returns the page's HTML with only its content left. `domain` is the listed site the page is on.
// With `keepImages`, images stay, with their src and alt.
export const cleanHTML = async function ({ pageHTML, pageURL, domain, domains, keepImages = false }) {
  let rewriter = new HTMLRewriter()

  const removedSelectors = [...removedElements, ...(extrasFor(domain).removeSelectors ?? [])].filter(function (selector) {
    return keepImages === false || selector !== `img`
  })

  for (const selector of removedSelectors) {
    rewriter = rewriter.on(selector, {
      element (element) {
        element.remove()
      },
    })
  }

  // Spans carry no structure, and syntax-highlighted code has one around nearly every word
  rewriter = rewriter.on(`span`, {
    element (element) {
      element.removeAndKeepContent()
    },
  })

  rewriter = rewriter.on(`*`, {
    element (element) {
      const href = element.tagName === `a` ? element.getAttribute(`href`) : null
      // Without keepImages, images are removed above
      const isImage = keepImages && element.tagName === `img`
      const src = isImage ? element.getAttribute(`src`) : null
      const alt = isImage ? element.getAttribute(`alt`) : null
      const names = [...element.attributes].map(([name]) => name)

      for (const name of names) {
        element.removeAttribute(name)
      }

      const target = linkTarget({ href, pageURL, domains })

      if (target != null) {
        element.setAttribute(`href`, target)
      }

      // One that can't be shown outside the page (embedded in it, or with no src) goes
      if (isImage) {
        const source = imageSource({ src, pageURL })

        if (source == null) {
          element.remove()
          return
        }

        element.setAttribute(`src`, source)

        // Still encoded, as it came, so it goes back in as it was
        if (alt != null && alt.trim() !== ``) {
          element.setAttribute(`alt`, alt)
        }
      }
    },
  })

  let html = await rewriter.transform(new Response(pageHTML)).text()

  html = html.replace(/<!--[\s\S]*?-->/g, ``)
  html = html.replace(/<!doctype[^>]*>/i, ``)
  // Non-breaking spaces would come through as odd spaces in the Markdown
  html = html.replace(/&nbsp;|&#160;|\u00a0/g, ` `)
  html = collapseWhitespace(html)

  // Removing one empty wrapper can leave its parent empty, so repeat until nothing changes
  let previous = null

  while (previous !== html) {
    previous = html
    html = html.replace(emptyElementPattern, ``)
  }

  return html.trim()
}

const turndown = new TurndownService({
  headingStyle: `atx`,
  codeBlockStyle: `fenced`,
  bulletListMarker: `-`,
})

// Tables and strikethrough
turndown.use(gfm)

// A Markdown table row is one line, but cells often hold block elements (GitHub's file list
// has several per cell), which would break the table across many lines
turndown.addRule(`singleLineTableCell`, {
  filter: [`th`, `td`],
  replacement (content, node) {
    const text = content.replace(/\s+/g, ` `).replace(/\|/g, `\\|`).trim()
    const isFirst = node.previousElementSibling == null

    return `${isFirst ? `| ` : ` `}${text} |`
  },
})

// Icon-only links have no text left once images and svgs are removed. A link around an image
// that's kept (see cleanHTML's keepImages) stays.
turndown.addRule(`emptyLink`, {
  filter (node) {
    return node.nodeName === `A` && node.textContent.trim() === `` && node.querySelector(`img`) == null
  },
  replacement () {
    return ``
  },
})

// Turndown only fences a <pre> with a <code> inside; a bare <pre> would lose its line breaks
// and indentation as Markdown
turndown.addRule(`preWithoutCode`, {
  filter (node) {
    return node.nodeName === `PRE` && node.firstChild?.nodeName !== `CODE`
  },
  replacement (content, node) {
    return `\n\n\`\`\`\n${node.textContent.replace(/\n$/, ``)}\n\`\`\`\n\n`
  },
})

// Whether a non-HTML response can be read as text (a source file, JSON, …) rather than being
// an image, archive or other binary file
const isTextType = function (contentType) {
  return contentType.startsWith(`text/`) || /json|xml|javascript|yaml|toml/.test(contentType)
}

// A failed page load => a message the model can pass on to the user
const describeFailure = function ({ status, statusText }) {
  if (status === 404) {
    return `There's no such page. It may not exist, or it may be private.`
  }

  if (status === 429) {
    return `The site is limiting how fast pages can be read. Try again in a minute.`
  }

  return `The site answered ${status} ${statusText}.`
}

// Downloads a page on one of the listed `domains` (or a subdomain of one) and returns
// { url, markdown, reader } for an HTML page, or { url, text } for a text file, which needs no
// conversion. `url` is where the page ended up after redirects. With a `readerModel` (see
// lemonade.isPageReaderModel), `reader` says how it went: { model, seconds, kept, total,
// isUnfinished } (how many of the page's blocks it kept), or { model, failed } with the error
// when it couldn't, and the page was converted directly instead. Without one, `reader` is null.
// Throws with a message for the model when the page can't be read.
export const readPage = async function ({ url, domains, readerModel = null, signal }) {
  let pageURL

  try {
    // Models sometimes leave off the https://
    pageURL = new URL(url.includes(`://`) ? url : `https://${url}`)
  } catch (err) {
    throw new Error(`"${url}" isn't a URL.`)
  }

  const domain = matchDomain(pageURL.hostname, domains)

  if (domain == null) {
    throw new Error(`${pageURL.hostname} isn't on the list of sites that can be read: ${describeDomains(domains)}.`)
  }

  const rewriteURL = extrasFor(domain).rewriteURL

  if (rewriteURL != null) {
    pageURL = rewriteURL(pageURL)
  }

  const page = await browser.loadPage({ url: pageURL.href, signal })

  if (page.status >= 400) {
    throw new Error(describeFailure(page))
  }

  if (page.html == null) {
    if (isTextType(page.contentType) === false || page.text == null) {
      throw new Error(`That's a ${page.contentType || `binary`} file, which can't be read as text.`)
    }

    return { url: page.url, text: page.text }
  }

  const finalURL = page.url

  // Without a page reader, or when it can't read the page
  const convertDirectly = async function () {
    const html = await cleanHTML({ pageHTML: page.html, pageURL: finalURL, domain, domains })
    return turndown.turndown(html)
  }

  if (readerModel == null) {
    return { url: finalURL, markdown: await convertDirectly(), reader: null }
  }

  const started = Date.now()

  try {
    // MinerU-HTML reads the page as it came, with the class names and ids that help tell its
    // parts apart; what it keeps is then cleaned and converted as usual, images included
    const main = await mainContent.readMainContent({ pageHTML: page.html, model: readerModel, signal })
    const mainHTML = await cleanHTML({ pageHTML: main.html, pageURL: finalURL, domain, domains, keepImages: true })
    const seconds = Math.round((Date.now() - started) / 1000)
    const reader = { model: readerModel, seconds, kept: main.kept, total: main.total, isUnfinished: main.isUnfinished }

    return { url: finalURL, markdown: turndown.turndown(mainHTML), reader }
  } catch (err) {
    if (signal.aborted === true) {
      throw err
    }

    // The page can still be read, just as it would be without a page reader
    console.error(`Page reader ${readerModel} failed`, err)
    return { url: finalURL, markdown: await convertDirectly(), reader: { model: readerModel, failed: err.message } }
  }
}

export default {
  cleanHTML,
  readPage,
}
