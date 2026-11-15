import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import egressProxy from './egressProxy.js'

// One headless Chrome, shared by every read_web_page call, so pages are read as a browser
// renders them (content that a site builds with JavaScript included). It starts on first use
// and closes after a while unused to give its memory back.
//
// The stealth plugin makes it look like an ordinary Chrome (a normal User-Agent, no webdriver
// flag), so sites that turn away headless browsers mostly serve it; some still will.
//
// The browser is installed separately from the package: bunx puppeteer browsers install chrome-headless-shell
//
// Everything it fetches goes through the egress proxy (ai-tools/egressProxy.js), which only
// connects to public addresses, so no page can reach this machine or the networks it's on. On
// top of that, loadPage only lets the tab itself go to the hosts the caller allows, redirects
// included, and only over http(s).

puppeteer.use(StealthPlugin())

const navigationTimeout = 1000 * 30

// After the page's HTML arrives, how long to wait for its scripts to finish fetching content.
// Some sites never stop fetching, so this is a cap, not a requirement.
const settleIdleTime = 500
const settleTimeout = 1000 * 5

const idleCloseDelay = 1000 * 60 * 5

// Requests that only matter for how a page looks
const skippedResourceTypes = [`image`, `media`, `font`]

// The schemes a page's own requests may use; a navigation must be http(s)
const subresourceSchemes = [`http:`, `https:`, `data:`, `blob:`]

// How long reading the loaded page may take, and how much of it is kept
const readTimeout = 1000 * 15
const maxHTMLChars = 1024 * 1024 * 5
const maxTextChars = 1024 * 1024 * 2

// Chrome's own extra connections are off, and it may only reach the network through the
// proxy: nothing bypasses it (not even localhost, which Chrome would by default), WebRTC can't
// use UDP around it, and QUIC (which a proxy can't carry) is off
const launchArgs = function (proxyURL) {
  return [
    `--proxy-server=${proxyURL}`,
    `--proxy-bypass-list=<-loopback>`,
    `--disable-quic`,
    `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`,
    `--webrtc-ip-handling-policy=disable_non_proxied_udp`,
    `--disable-background-networking`,
    `--disable-component-update`,
    `--disable-default-apps`,
    `--disable-domain-reliability`,
    `--disable-sync`,
    `--disable-extensions`,
    `--no-first-run`,
    `--no-pings`,
  ]
}

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

  browserPromise = egressProxy.getProxyURL().then(function (proxyURL) {
    return puppeteer.launch({ headless: `shell`, args: launchArgs(proxyURL) })
  })

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

// Settles with what `promise` gives, or throws `message` after `ms`
const withTimeout = function (promise, ms, message) {
  let timer = null

  const timeout = new Promise(function (resolve, reject) {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Opens `url` in a fresh incognito tab and returns { url, status, statusText, contentType }
// plus `html` (the page as rendered) for a web page, or `text` for anything else (e.g. a raw
// file). `url` is where it ended up after redirects. `isAllowedHost(hostname)` says which
// hosts the tab may go to: a redirect anywhere else is stopped before it's requested, and this
// throws saying where it led. Aborting `signal` closes the tab, which makes this throw.
export const loadPage = async function ({ url, isAllowedHost, signal }) {
  openReads += 1
  clearTimeout(idleTimer)

  let context = null

  const stop = function () {
    context?.close().catch(() => {})
  }

  try {
    const browser = await getBrowser()

    // Its own cookies and storage, thrown away afterwards; nothing is downloaded
    context = await browser.createBrowserContext({ downloadBehavior: { policy: `deny` } })
    signal.addEventListener(`abort`, stop)
    signal.throwIfAborted()

    const page = await context.newPage()

    // const userAgent = (await browser.userAgent())
    //   .replace('HeadlessChrome/', 'Chrome/')

    // await page.setUserAgent({ userAgent })

    // A page's service worker could answer requests without them passing through here
    await page.setBypassServiceWorker(true)
    await page.setRequestInterception(true)

    // Where the tab was stopped from going, when it was
    let blockedNavigation = null

    page.on(`request`, function (request) {
      let target = null

      try {
        target = new URL(request.url())
      } catch (err) {
        request.abort(`blockedbyclient`).catch(() => {})
        return
      }

      const isTabNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame()

      if (isTabNavigation) {
        const isWebScheme = target.protocol === `https:` || target.protocol === `http:`

        if (isWebScheme === false || isAllowedHost(target.hostname) === false) {
          blockedNavigation = target.href
          request.abort(`blockedbyclient`).catch(() => {})
          return
        }
      } else if (subresourceSchemes.includes(target.protocol) === false) {
        request.abort(`blockedbyclient`).catch(() => {})
        return
      }

      if (skippedResourceTypes.includes(request.resourceType())) {
        request.abort().catch(() => {})
      } else {
        request.continue().catch(() => {})
      }
    })

    // A page can't open more tabs, or stall the read with an alert()
    page.on(`popup`, function (popup) {
      popup?.close().catch(() => {})
    })

    page.on(`dialog`, function (dialog) {
      dialog.dismiss().catch(() => {})
    })

    let response = null

    try {
      response = await page.goto(url, { waitUntil: `domcontentloaded`, timeout: navigationTimeout })
    } catch (err) {
      if (blockedNavigation != null) {
        throw new Error(`The page led to ${blockedNavigation}, which isn't on the list of sites that can be read.`)
      }

      // The proxy refused the connection: a private address, or a port other than 443
      if (err.message.includes(`ERR_TUNNEL_CONNECTION_FAILED`)) {
        throw new Error(`${new URL(url).host} can't be reached: only public sites, over HTTPS, can be read.`)
      }

      throw err
    }

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
      const text = await withTimeout(response.text(), readTimeout, `Reading the file took too long.`).catch(() => null)
      result.text = text == null ? null : text.slice(0, maxTextChars)
      return result
    }

    try {
      await page.waitForNetworkIdle({ idleTime: settleIdleTime, timeout: settleTimeout })
    } catch (err) {
      // Still busy after settleTimeout; read what's there
    }

    // A script that tries to send the tab elsewhere after it loads is stopped by the request
    // handler, and the tab stays where it is; this only makes sure of it
    if (isAllowedHost(new URL(page.url()).hostname) === false) {
      throw new Error(`The page led to ${page.url()}, which isn't on the list of sites that can be read.`)
    }

    const html = await withTimeout(page.content(), readTimeout, `Reading the page took too long.`)
    result.html = html.slice(0, maxHTMLChars)

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
