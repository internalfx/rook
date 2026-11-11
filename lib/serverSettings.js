import fs from 'node:fs'
import path from 'node:path'
import config from '../configure.js'
import db from './db.js'
import lemonade from './lemonade.js'
import { imageSizes, defaultImageSize } from '../ai-tools/images.js'
import { parseDomains } from '../ai-tools/sites.js'
import { formatContextLength } from './format.js'

// The settings an admin changes on the Admin pages (Lemonade, Models, Tools, Briefings), kept in the serverSettings table and loaded
// onto config.lemonade, config.models, config.tools and config.briefings, which the rest of rook
// reads as it always has. Every reader looks at them when it runs, so a save takes effect at
// once: the next chat message, briefing or cron tick sees the new values, while a reply already
// under way keeps what it started with.

// Every key, with what it is until an admin sets it
export const defaults = {
  'lemonade.host': ``,
  'lemonade.apikey': ``,
  'models.chat': null,
  'models.image': null,
  'models.imageSize': defaultImageSize,
  'models.embedding': null,
  'models.pageReader': null,
  'tools.webPages': true,
  'tools.webDomains': [],
  'tools.webSearch': false,
  'tools.memories': false,
  'tools.tasks': true,
  'tools.taskRequests': true,
  'briefings.on': false,
  'briefings.minutes': 360,
}

// What each model is for, in the order the pages show them, and the label Lemonade gives models
// of that kind
export const modelRoles = [
  { key: `chat`, role: `Chat`, label: `chat` },
  { key: `image`, role: `Image`, label: `image` },
  { key: `embedding`, role: `Embedding`, label: `embeddings` },
  { key: `pageReader`, role: `Page reader`, label: `chat` },
]

const selectAll = db.query(`SELECT key, value FROM serverSettings`)
const countRows = db.query(`SELECT COUNT(*) AS count FROM serverSettings`)
const upsert = db.query(`
  INSERT INTO serverSettings (key, value, updatedAt) VALUES ($key, $value, $now)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
`)

// Puts the values (a { 'section.name': value } object) onto config's four objects, in place, so
// every module holding config.models and the like sees them
const apply = function (values) {
  for (const [key, value] of Object.entries(values)) {
    const [section, name] = key.split(`.`)
    config[section][name] = value
  }
}

// Reads the table, fills in the defaults for what's unset, and applies it all. On the first start
// with a config.js still beside the app, its settings are copied in first.
export const load = async function () {
  await importConfigFile()

  const values = { ...defaults }

  for (const row of selectAll.all()) {
    if (Object.hasOwn(defaults, row.key)) {
      values[row.key] = JSON.parse(row.value).v
    }
  }

  apply(values)
}

// Writes the keys given (a validated { 'section.name': value } object), then reloads, so what's
// in memory is exactly what's saved
export const save = function (values) {
  const now = new Date().toISOString()

  const writeAll = db.transaction(function () {
    for (const [key, value] of Object.entries(values)) {
      if (Object.hasOwn(defaults, key) === false) {
        throw new Error(`"${key}" isn't a server setting`)
      }

      upsert.run({ key, value: JSON.stringify({ v: value }), now })
    }
  })

  writeAll()

  const current = { ...defaults }

  for (const row of selectAll.all()) {
    if (Object.hasOwn(defaults, row.key)) {
      current[row.key] = JSON.parse(row.value).v
    }
  }

  apply(current)

  // A model remembered from the old server, or one since removed, shouldn't be trusted
  lemonade.clearModelCache()
}

// Whether there's enough to chat: a Lemonade server and a chat model
export const isSetUp = function () {
  return config.lemonade.host !== `` && config.models.chat != null
}

// FORMS

// The fields the settings forms post => the keys validate takes. Only the fields in `body` are
// included, so a page can post a few. Checkboxes are only read when named in `switches` (or all of
// them, with true), since an unticked one isn't posted at all and then means off: only the boxes
// a page shows may be read that way.
export const readForm = function (body, { switches = false } = {}) {
  const fields = {
    lemonadeHost: `lemonade.host`,
    lemonadeKey: `lemonade.apikey`,
    chatModel: `models.chat`,
    imageModel: `models.image`,
    imageSize: `models.imageSize`,
    embeddingModel: `models.embedding`,
    pageReaderModel: `models.pageReader`,
    webDomains: `tools.webDomains`,
    briefingMinutes: `briefings.minutes`,
  }
  const switchFields = {
    webPages: `tools.webPages`,
    webSearch: `tools.webSearch`,
    memories: `tools.memories`,
    tasks: `tools.tasks`,
    taskRequests: `tools.taskRequests`,
    briefingsOn: `briefings.on`,
  }
  const input = {}

  for (const [field, key] of Object.entries(fields)) {
    if (Object.hasOwn(body, field)) {
      input[key] = body[field]
    }
  }

  for (const [field, key] of Object.entries(switchFields)) {
    if (switches === true || (Array.isArray(switches) && switches.includes(field))) {
      input[key] = body[field] ?? ``
    }
  }

  return input
}

// A posted settings form, saved when it's all right: { values, errors }. The admin pages each
// post their own few fields.
export const saveForm = function (body, { switches = false } = {}) {
  const { values, errors } = validate(readForm(body, { switches }))

  if (errors.length === 0) {
    save(values)
  }

  return { values, errors }
}

// VALIDATION

// A checkbox comes as "on" (or not at all), a saved value as a boolean
const toSwitch = function (value) {
  if (typeof value === `boolean`) {
    return value
  }

  return [`true`, `on`, `1`].includes(`${value ?? ``}`.trim().toLowerCase())
}

// A model name as typed or chosen, or null for none
const toModelName = function (value) {
  if (value == null) {
    return null
  }

  const text = `${value}`.trim()

  return text === `` ? null : text
}

// A Lemonade address, trimmed and without a trailing slash, or null when it isn't a URL
const toHost = function (value) {
  const text = `${value ?? ``}`.trim().replace(/\/+$/, ``)

  if (text === ``) {
    return ``
  }

  try {
    const url = new URL(text)

    if ([`http:`, `https:`].includes(url.protocol) === false) {
      return null
    }
  } catch (err) {
    return null
  }

  return text
}

// Checks the settings in `input` (a { 'section.name': value } object, as a form posts them or as
// config.js had them) and returns { values, errors }: the keys given, cleaned up, and what's wrong
// with any of them in words. Only the keys present are checked, so a page can save a few at a
// time; the rule that memories need an embedding model looks at what's already saved for the
// half that isn't being changed.
export const validate = function (input) {
  const values = {}
  const errors = []

  if (Object.hasOwn(input, `lemonade.host`)) {
    const host = toHost(input[`lemonade.host`])

    if (host == null) {
      errors.push(`The Lemonade server should be an address like http://localhost:8000.`)
    } else {
      values[`lemonade.host`] = host
    }
  }

  if (Object.hasOwn(input, `lemonade.apikey`)) {
    values[`lemonade.apikey`] = `${input[`lemonade.apikey`] ?? ``}`.trim()
  }

  for (const key of [`chat`, `image`, `embedding`, `pageReader`]) {
    if (Object.hasOwn(input, `models.${key}`)) {
      values[`models.${key}`] = toModelName(input[`models.${key}`])
    }
  }

  if (values[`models.pageReader`] != null && lemonade.isPageReaderModel({ id: values[`models.pageReader`] }) === false) {
    errors.push(`The page reader should be a MinerU-HTML model, or none.`)
  }

  if (Object.hasOwn(input, `models.imageSize`)) {
    const size = `${input[`models.imageSize`] ?? ``}`.trim()

    if (imageSizes.includes(size) === false) {
      errors.push(`The image size should be one of ${imageSizes.join(`, `)}.`)
    } else {
      values[`models.imageSize`] = size
    }
  }

  for (const key of [`webPages`, `webSearch`, `memories`, `tasks`, `taskRequests`]) {
    if (Object.hasOwn(input, `tools.${key}`)) {
      values[`tools.${key}`] = toSwitch(input[`tools.${key}`])
    }
  }

  if (Object.hasOwn(input, `tools.webDomains`)) {
    const given = input[`tools.webDomains`]
    const text = Array.isArray(given) ? given.join(`\n`) : `${given ?? ``}`
    const { domains, invalid } = parseDomains(text)

    if (invalid.length > 0) {
      errors.push(`These aren't sites: ${invalid.join(`, `)}. Give one site a line, like github.com.`)
    } else {
      values[`tools.webDomains`] = domains
    }
  }

  const memoriesOn = values[`tools.memories`] ?? config.tools.memories ?? false
  const embeddingModel = Object.hasOwn(values, `models.embedding`) ? values[`models.embedding`] : config.models.embedding

  if (memoriesOn === true && embeddingModel == null) {
    errors.push(`Memories need an embedding model: choose one, or turn memories off.`)
  }

  if (Object.hasOwn(input, `briefings.on`)) {
    values[`briefings.on`] = toSwitch(input[`briefings.on`])
  }

  if (Object.hasOwn(input, `briefings.minutes`)) {
    const minutes = Number(`${input[`briefings.minutes`] ?? ``}`.trim())

    if (Number.isInteger(minutes) === false || minutes < 1 || minutes > 1440) {
      errors.push(`The briefing interval should be a whole number of minutes from 1 to 1440.`)
    } else {
      values[`briefings.minutes`] = minutes
    }
  }

  return { values, errors }
}

// MODELS ON THE SERVER

// The models Lemonade lists, as the names to offer for each role: { chat, image, embedding,
// pageReader }, each a list of ids. MinerU-HTML models are page readers, not chat models.
export const groupModels = function (models) {
  const groups = { chat: [], image: [], embedding: [], pageReader: [] }

  for (const model of models) {
    if (lemonade.isPageReaderModel(model)) {
      groups.pageReader.push(model.id)
    } else if (lemonade.hasLabel(model, `chat`)) {
      groups.chat.push(model.id)
    }

    if (lemonade.hasLabel(model, `image`)) {
      groups.image.push(model.id)
    }

    if (lemonade.hasLabel(model, `embeddings`)) {
      groups.embedding.push(model.id)
    }
  }

  return groups
}

// The saved server's models by role, or null with the error when it can't be reached
export const listModelGroups = async function () {
  if (config.lemonade.host === ``) {
    return { groups: null, error: `No Lemonade server is set.` }
  }

  try {
    return { groups: groupModels(await lemonade.listModels()), error: null }
  } catch (err) {
    return { groups: null, error: err.message }
  }
}

// Every model the saved server has, as Admin → Models shows them, with the roles each is chosen
// for; `missing` names the roles whose model the server doesn't list ("Chat: name"). Null models
// with the error when the server can't be reached.
export const listServerModels = async function () {
  if (config.lemonade.host === ``) {
    return { models: null, missing: [], error: `No Lemonade server is set.` }
  }

  let listed

  try {
    listed = await lemonade.listModels()
  } catch (err) {
    return { models: null, missing: [], error: err.message }
  }

  const models = listed.map(function (model) {
    const roles = modelRoles.filter(function ({ key }) {
      return config.models[key] === model.id
    }).map(function ({ role }) {
      return role
    })

    return {
      id: model.id,
      labels: model.labels ?? [],
      sizeGB: model.size ?? null,
      contextLength: formatContextLength(model.context_length),
      downloaded: model.downloaded === true,
      updateAvailable: model.update_available === true,
      roles,
    }
  })

  const missing = modelRoles.filter(function ({ key }) {
    const name = config.models[key]

    return name != null && listed.some((model) => model.id === name) === false
  }).map(function ({ key, role }) {
    return `${role}: ${config.models[key]}`
  })

  return { models, missing, error: null }
}

// Tries an address and key before they're saved: { ok, host, summary } or { ok: false, error }
export const checkServer = async function ({ host, apikey }) {
  const checked = validate({ 'lemonade.host': host, 'lemonade.apikey': apikey })

  if (checked.errors.length > 0) {
    return { ok: false, error: checked.errors[0] }
  }

  if (checked.values[`lemonade.host`] === ``) {
    return { ok: false, error: `Give the server's address.` }
  }

  try {
    const models = await lemonade.probe({ host: checked.values[`lemonade.host`], apikey: checked.values[`lemonade.apikey`] })
    const groups = groupModels(models)
    const summary = `${models.length} models: ${groups.chat.length} chat, ${groups.embedding.length} embedding, ${groups.image.length} image, ${groups.pageReader.length} page reader`

    return { ok: true, host: checked.values[`lemonade.host`], summary }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// Each model that's set, and whether the Lemonade server has it as the right kind:
// { host, reachable, error, models: [{ key, role, name, found, rightKind }] }
export const describeModels = async function () {
  const host = config.lemonade.host
  const wanted = modelRoles.filter(function ({ key }) {
    return config.models[key] != null
  }).map(function ({ key, role, label }) {
    return { key, role, label, name: config.models[key], found: false, rightKind: false }
  })

  if (host === ``) {
    return { host, reachable: false, error: `No Lemonade server is set.`, models: wanted }
  }

  let listed

  try {
    listed = await lemonade.listModels()
  } catch (err) {
    return { host, reachable: false, error: err.message, models: wanted }
  }

  for (const model of wanted) {
    const match = listed.find(function (candidate) {
      return candidate.id === model.name
    })

    model.found = match != null
    model.rightKind = match != null && lemonade.hasLabel(match, model.label)
  }

  return { host, reachable: true, error: null, models: wanted }
}

// Logged after the server starts: each model that's set but isn't on the Lemonade server, or isn't
// the right kind there. A server that can't be reached is mentioned once instead.
export const warnAboutModels = async function () {
  if (isSetUp() === false) {
    console.warn(`ROOK isn't set up yet: open it in a browser to choose a Lemonade server and a chat model.`)
    return
  }

  const status = await describeModels()

  if (status.reachable === false) {
    console.warn(`Couldn't check the models against the Lemonade server: ${status.error}`)
    return
  }

  for (const model of status.models) {
    if (model.found === false) {
      console.warn(`The ${model.role.toLowerCase()} model "${model.name}" isn't on the Lemonade server.`)
    } else if (model.rightKind === false) {
      console.warn(`"${model.name}" isn't a ${model.label} model on the Lemonade server.`)
    }
  }
}

// THE OLD config.js

// Settings used to live in config.js. The first start that finds one beside the app, with nothing
// saved yet, copies its lemonade, models, tools and briefings sections in; after that the file is
// only mentioned, so it gets deleted.
const importConfigFile = async function () {
  const configPath = path.join(config.appDir, `config.js`)

  if (fs.existsSync(configPath) === false) {
    return
  }

  const advice = `config.js is no longer read: delete it, and set the port, host and production mode with ROOK_PORT, ROOK_HOST and ROOK_ENV if you had changed them.`

  if (countRows.get().count > 0) {
    console.warn(advice)
    return
  }

  let old

  try {
    old = (await import(configPath)).default ?? {}
  } catch (err) {
    console.warn(`Couldn't read config.js to import its settings: ${err.message}`)
    return
  }

  const input = {}

  for (const section of [`lemonade`, `models`, `tools`, `briefings`]) {
    for (const [name, value] of Object.entries(old[section] ?? {})) {
      if (Object.hasOwn(defaults, `${section}.${name}`)) {
        input[`${section}.${name}`] = value
      }
    }
  }

  const { values, errors } = validate(input)

  save(values)

  console.log(`Imported the settings from config.js into the database (${Object.keys(values).length} of them). ${advice}`)

  for (const error of errors) {
    console.warn(`Not imported from config.js: ${error}`)
  }
}

export default {
  defaults,
  modelRoles,
  load,
  save,
  isSetUp,
  readForm,
  saveForm,
  validate,
  groupModels,
  listModelGroups,
  listServerModels,
  checkServer,
  describeModels,
  warnAboutModels,
}
