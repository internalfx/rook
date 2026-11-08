import config from '../configure.js'
import lemonade from './lemonade.js'
import { imageSizes, defaultImageSize } from '../ai-tools/images.js'
import { parseDomains } from '../ai-tools/sites.js'

// The server-wide options in config.js (models, tools and briefings) are checked when the server
// starts, since a mistake there would otherwise only show up as a Lemonade error part way through
// a chat. A bad value stops the server with what's wrong; a model Lemonade doesn't have is only
// warned about, because Lemonade may be down.

const fail = function (message) {
  console.error(`config.js: ${message}`)
  process.exit(1)
}

const isModelName = function (value) {
  return value == null || (typeof value === `string` && value.trim() !== ``)
}

const isSwitch = function (value) {
  return value == null || typeof value === `boolean`
}

const isText = function (value) {
  return typeof value === `string` && value.trim() !== ``
}

// Fills in what's left out, so the rest of rook can read config.models.chat and the like
// directly, and stops on what's wrong
export const checkConfig = function () {
  config.env = config.env ?? `development`

  if ([`development`, `production`].includes(config.env) === false) {
    fail(`env should be \`development\` or \`production\`.`)
  }

  // configure.js worked these out before the default above could apply
  config.isProduction = config.env === `production`
  config.isDevelopment = config.isProduction === false

  config.port = config.port ?? 8005

  if (Number.isInteger(config.port) === false || config.port < 1 || config.port > 65535) {
    fail(`port should be a whole number from 1 to 65535.`)
  }

  config.host = config.host ?? `0.0.0.0`

  if (isText(config.host) === false) {
    fail(`host should be an address to listen on, like \`0.0.0.0\` or \`127.0.0.1\`.`)
  }

  config.appName = config.appName ?? `ROOK`

  if (isText(config.appName) === false) {
    fail(`appName should be a name.`)
  }

  config.koa = config.koa ?? {}
  config.koa.proxy = config.koa.proxy ?? false
  config.koa.cors = config.koa.cors ?? {}

  if (isSwitch(config.koa.proxy) === false) {
    fail(`koa.proxy should be true or false.`)
  }

  config.session = config.session ?? {}
  config.session.sessionCookieName = config.session.sessionCookieName ?? `ROOK.token`
  config.session.sessionCookieMaxAge = config.session.sessionCookieMaxAge ?? 1000 * 60 * 60 * 24 * 365

  if (isText(config.session.sessionCookieName) === false) {
    fail(`session.sessionCookieName should be a cookie name.`)
  }

  if (Number.isInteger(config.session.sessionCookieMaxAge) === false || config.session.sessionCookieMaxAge < 1) {
    fail(`session.sessionCookieMaxAge should be a number of milliseconds.`)
  }

  config.lemonade = config.lemonade ?? {}

  if (isText(config.lemonade.host) === false) {
    fail(`lemonade.host is missing: the Lemonade server's address, like http://localhost:8000.`)
  }

  config.lemonade.host = config.lemonade.host.trim().replace(/\/+$/, ``)
  config.lemonade.apikey = config.lemonade.apikey ?? ``

  if (typeof config.lemonade.apikey !== `string`) {
    fail(`lemonade.apikey should be the server's API key, or empty.`)
  }

  config.models = config.models ?? {}
  config.tools = config.tools ?? {}
  config.briefings = config.briefings ?? {}

  const { models, tools, briefings } = config

  for (const key of [`chat`, `image`, `embedding`, `pageReader`]) {
    if (isModelName(models[key]) === false) {
      fail(`models.${key} should be a model name, or null.`)
    }

    models[key] = models[key] ?? null
  }

  if (models.chat == null) {
    fail(`models.chat is missing: name the chat model (bun scripts/models.js lists them).`)
  }

  models.imageSize = models.imageSize ?? defaultImageSize

  if (imageSizes.includes(models.imageSize) === false) {
    fail(`models.imageSize should be one of ${imageSizes.join(`, `)}.`)
  }

  if (models.pageReader != null && lemonade.isPageReaderModel({ id: models.pageReader }) === false) {
    fail(`models.pageReader should be a MinerU-HTML model, or null.`)
  }

  for (const key of [`webPages`, `webSearch`, `memories`, `tasks`]) {
    if (isSwitch(tools[key]) === false) {
      fail(`tools.${key} should be true or false.`)
    }
  }

  // Web pages and tasks are on unless switched off; web search and memories off unless switched on
  tools.webPages = tools.webPages ?? true
  tools.tasks = tools.tasks ?? true
  tools.webSearch = tools.webSearch ?? false
  tools.memories = tools.memories ?? false

  const webDomains = tools.webDomains ?? []

  if (Array.isArray(webDomains) === false || webDomains.every((domain) => typeof domain === `string`) === false) {
    fail(`tools.webDomains should be a list of sites, like [\`github.com\`].`)
  }

  const { domains, invalid } = parseDomains(webDomains.join(`\n`))

  if (invalid.length > 0) {
    fail(`these in tools.webDomains aren't sites: ${invalid.join(`, `)}. Give one site each, like github.com.`)
  }

  tools.webDomains = domains

  if (tools.memories === true && models.embedding == null) {
    fail(`tools.memories needs models.embedding: name an embedding model, or turn memories off.`)
  }

  if (isSwitch(briefings.on) === false) {
    fail(`briefings.on should be true or false.`)
  }

  briefings.on = briefings.on ?? false

  if (briefings.minutes != null && (Number.isInteger(briefings.minutes) === false || briefings.minutes < 1 || briefings.minutes > 1440)) {
    fail(`briefings.minutes should be a whole number from 1 to 1440.`)
  }
}

// Warns about each model named in config.js that the Lemonade server doesn't list, or lists as
// another kind of model. Lemonade being down is warned about once instead.
export const checkModels = async function () {
  let models = []

  try {
    models = await lemonade.listModels()
  } catch (err) {
    console.warn(`Couldn't check the models in config.js against the Lemonade server: ${err.message}`)
    return
  }

  const wanted = [
    { key: `chat`, label: `chat` },
    { key: `image`, label: `image` },
    { key: `embedding`, label: `embeddings` },
    { key: `pageReader`, label: `chat` },
  ]

  for (const { key, label } of wanted) {
    const name = config.models[key]

    if (name == null) {
      continue
    }

    const model = models.find((candidate) => candidate.id === name)

    if (model == null) {
      console.warn(`config.js: models.${key} "${name}" isn't on the Lemonade server.`)
    } else if (lemonade.hasLabel(model, label) === false) {
      console.warn(`config.js: models.${key} "${name}" isn't a ${label} model on the Lemonade server.`)
    }
  }
}

export default {
  checkConfig,
  checkModels,
}
