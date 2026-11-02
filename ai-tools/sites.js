// The sites read_web_page may read are a list of domains in Settings ("webDomains"), shared by
// every chat. A page is allowed when its host is a listed domain or a subdomain of one.
//
// Some sites read better with a few extras, applied whenever a listed domain has an entry here:
//   contents        what can be read there, told to the model
//   removeSelectors the site's own menus and banners, removed before conversion (the standard
//                   page banner and footer are removed on every site)
//   skipLinkPaths   links found on every page that lead nowhere useful (sign-in and the like)
//   rewriteURL      a page's URL => a better URL to read instead (or the same one)
export const siteExtras = {
  'github.com': {
    contents: `repositories, folders, files, issues, pull requests, commits, releases, users and organizations, and search results (https://github.com/search?q=QUERY&type=repositories, or type=issues, pullrequests, users)`,
    removeSelectors: [
      `header[aria-label="Global navigation menu"]`,
      // The file list repeats each name in a column for small screens
      `td.react-directory-row-name-cell-small-screen`,
      `thead th[colspan="2"]`,
    ],
    skipLinkPaths: [`/login`, `/signup`, `/join`, `/logout`, `/settings`, `/notifications`],
    // A file's page => the file itself, which is exact and needs no conversion
    rewriteURL (url) {
      const pieces = url.pathname.split(`/`)

      if (pieces[3] === `blob`) {
        pieces[3] = `raw`
        return new URL(pieces.join(`/`), url)
      }

      return url
    },
  },
  'wikipedia.org': {
    contents: `articles in every language`,
    removeSelectors: [
      // The menus (a dropdown each, including the other languages' versions), the contents
      // list and the navigation boxes at the end are most of an article's page
      `.vector-header-container`,
      `.vector-dropdown`,
      `.vector-page-toolbar`,
      `.vector-column-start`,
      `.vector-column-end`,
      `#vector-toc`,
      `.navbox`,
      `.mw-editsection`,
      // Notices to editors ("This article needs…")
      `.ambox`,
      `.mw-jump-link`,
      `.catlinks`,
      `.mw-footer-container`,
    ],
  },
}

const hostnamePattern = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/

// The listed domain that `hostname` belongs to (itself or a parent of it), or null
export const matchDomain = function (hostname, domains) {
  const host = hostname.toLowerCase()

  const found = domains.find(function (domain) {
    return host === domain || host.endsWith(`.${domain}`)
  })

  return found ?? null
}

export const extrasFor = function (domain) {
  return siteExtras[domain] ?? {}
}

// The Settings text box, one site per line => { domains, invalid }. Lines may be full URLs or
// start with "www."; either way only the domain is kept. `invalid` lists lines that aren't sites.
export const parseDomains = function (text) {
  const domains = []
  const invalid = []

  for (const rawLine of text.split(`\n`)) {
    const line = rawLine.trim()

    if (line === ``) {
      continue
    }

    let hostname = null

    try {
      hostname = new URL(line.includes(`://`) ? line : `https://${line}`).hostname.toLowerCase()
    } catch (err) {
      hostname = null
    }

    if (hostname != null) {
      hostname = hostname.replace(/^www\./, ``)
    }

    if (hostname == null || hostnamePattern.test(hostname) === false) {
      invalid.push(line)
    } else if (domains.includes(hostname) === false) {
      domains.push(hostname)
    }
  }

  return { domains, invalid }
}

// "github.com, docs.python.org", for messages to the model and the page
export const describeDomains = function (domains) {
  return domains.join(`, `)
}

export default {
  siteExtras,
  matchDomain,
  extrasFor,
  parseDomains,
  describeDomains,
}
