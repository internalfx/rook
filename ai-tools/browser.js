import puppeteer from '../private/puppeteer'

// One headless Chrome, shared by every read_web_page call, so pages are read as a browser
// renders them (content that a site builds with JavaScript included). It starts on first use
// and closes after a while unused to give its memory back.
//
// Chrome runs as itself, with its own "HeadlessChrome" User-Agent: sites that refuse automated
// visitors (Google search, say) will refuse this too.
//
// The browser is installed separately from the package: bunx puppeteer browsers install chrome-headless-shell

const navigationTimeout = 1000 * 30

// After the page's HTML arrives, how long to wait for its scripts to finish fetching content.
// Some sites never stop fetching, so this is a cap, not a requirement.
const settleIdleTime = 500
const settleTimeout = 1000 * 5

const idleCloseDelay = 1000 * 60 * 5

// Requests that only matter for how a page looks
const skippedResourceTypes = [`image`, `media`, `font`]

let browserPromise = null
let openReads = 0
let idleTimer = null

const getBrowser = async function () {
  if (browserPromise != null) {
    const browser = await browserPromise

    if (browser.connected) {
      return browser
    }
  }

  browserPromise = puppeteer.launch({ headless: `shell` })

  try {
    const browser = await browserPromise
    return browser
  } catch (err) {
    browserPromise = null
    throw new Error(`The headless browser couldn't start: ${err.message}`)
  }
}

const closeWhenIdle = function () {
  clearTimeout(idleTimer)

  idleTimer = setTimeout(async function () {
    if (openReads > 0 || browserPromise == null) {
      return
    }

    const closing = browserPromise
    browserPromise = null

    try {
      const browser = await closing
      await browser.close()
    } catch (err) {
      console.error(`Closing the headless browser failed`, err)
    }
  }, idleCloseDelay)
}

// Opens `url` in a fresh incognito tab and returns { url, status, statusText, contentType }
// plus `html` (the page as rendered) for a web page, or `text` for anything else (e.g. a raw
// file). `url` is where it ended up after redirects. Aborting `signal` closes the tab, which
// makes this throw.
export const loadPage = async function ({ url, signal }) {
  openReads += 1
  clearTimeout(idleTimer)

  let context = null

  const stop = function () {
    context?.close().catch(() => {})
  }

  try {
    const browser = await getBrowser()

    // Its own cookies and storage, thrown away afterwards
    context = await browser.createBrowserContext()
    signal.addEventListener(`abort`, stop)
    signal.throwIfAborted()

    const page = await context.newPage()

    // const userAgent = (await browser.userAgent())
    //   .replace('HeadlessChrome/', 'Chrome/')

    // await page.setUserAgent({ userAgent })

    await page.setRequestInterception(true)

    page.on(`request`, function (request) {
      if (skippedResourceTypes.includes(request.resourceType())) {
        request.abort().catch(() => {})
      } else {
        request.continue().catch(() => {})
      }
    })

    const response = await page.goto(url, { waitUntil: `domcontentloaded`, timeout: navigationTimeout })

    if (response == null) {
      throw new Error(`The page didn't load.`)
    }

    const result = {
      url: page.url(),
      status: response.status(),
      statusText: response.statusText(),
      contentType: (response.headers()[`content-type`] ?? ``).toLowerCase(),
    }

    // A binary file can't be decoded as text; `text` is null for those
    if (result.contentType.includes(`text/html`) === false) {
      result.text = await response.text().catch(() => null)
      return result
    }

    try {
      await page.waitForNetworkIdle({ idleTime: settleIdleTime, timeout: settleTimeout })
    } catch (err) {
      // Still busy after settleTimeout; read what's there
    }

    result.html = await page.content()

    return result
  } catch (err) {
    signal.throwIfAborted()
    throw err
  } finally {
    signal.removeEventListener(`abort`, stop)
    stop()
    openReads -= 1
    closeWhenIdle()
  }
}

export default {
  loadPage,
}
