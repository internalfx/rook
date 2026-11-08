
import config from '../configure.js'
import prompts from './prompts.js'
import caches from './caches.js'

// Lemonade Server: an OpenAI-compatible API for local models
// https://lemonade-server.ai

const requestTimeout = 1000 * 10

// For requests that can legitimately run for minutes: loading a big model, or generating a large
// image with a slow model. Bun's fetch has its own 5-minute default timeout, which is too short
// for these, so those requests switch it off (`timeout: false`, a Bun-only fetch option) and use
// this limit instead.
const slowRequestLimit = 1000 * 60 * 10

const getHeaders = function () {
  const headers = { 'Content-Type': `application/json` }

  if (config.lemonade.apikey !== ``) {
    headers.Authorization = `Bearer ${config.lemonade.apikey}`
  }

  return headers
}

// A failed response => an error with Lemonade's own message, which is shown to the user. Lemonade
// answers with { error: { message } } as JSON; anything else is used as it is.
const failure = async function (what, response) {
  const errorText = await response.text()
  let message = errorText.trim()

  try {
    const body = JSON.parse(errorText)
    const errorMessage = body.error?.message ?? body.error

    if (typeof errorMessage === `string` && errorMessage !== ``) {
      message = errorMessage
    }
  } catch (err) {}

  if (message === ``) {
    message = `${response.status} ${response.statusText}`
  }

  return new Error(`Lemonade ${what} failed: ${message}`)
}

const request = async function (method, apiPath) {
  const url = `${config.lemonade.host}/api/v1${apiPath}`

  const response = await fetch(url, {
    method,
    headers: getHeaders(),
    signal: AbortSignal.timeout(requestTimeout),
  })

  if (response.ok === false) {
    throw new Error(`Lemonade ${method} ${apiPath} failed: ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  return body
}

export const listModels = async function () {
  const body = await request(`GET`, `/models`)

  return body.data
}

// For the Admin page: what's loaded right now, with each model's device, state and context size
// (all_models_loaded)
export const getHealth = function () {
  return request(`GET`, `/health`)
}

// Request and token totals since Lemonade started, and the last request's time to first token
// and tokens per second
export const getStats = function () {
  return request(`GET`, `/stats`)
}

// The machine: processor, memory, GPUs and NPU, and the model storage
export const getSystemInfo = function () {
  return request(`GET`, `/system-info`)
}

// Lemonade labels each model with what it can do, e.g. "chat", "image", "tts", "tool-calling"
export const hasLabel = function (model, label) {
  const labels = model.labels ?? []
  return labels.includes(label)
}

// MinerU-HTML models pick out a web page's main content, for read_web_page (see labelHTML).
// Lemonade has no label for them (it labels them "chat"), so they're known by name.
export const isPageReaderModel = function (model) {
  return /mineru-html/i.test(model.id)
}

// Models that can hold a conversation, e.g. not image or speech models, nor page readers
export const listChatModels = async function () {
  const models = await listModels()

  const chatModels = models.filter(function (model) {
    return hasLabel(model, `chat`) && isPageReaderModel(model) === false
  })

  return chatModels
}

export const listImageModels = async function () {
  const models = await listModels()

  const imageModels = models.filter(function (model) {
    return hasLabel(model, `image`)
  })

  return imageModels
}

// Models that turn text into vectors, for searching memories by meaning
export const listEmbeddingModels = async function () {
  const models = await listModels()

  const embeddingModels = models.filter(function (model) {
    return hasLabel(model, `embeddings`)
  })

  return embeddingModels
}

// The model with the id `model` as Lemonade lists it, or null when the server doesn't have it.
// Remembered for a minute, so a chat with images or a search doesn't ask Lemonade every time.
export const findModel = async function (model) {
  const key = `findModel:${model}`
  const cached = caches.flash.get(key)

  if (cached != null) {
    return cached
  }

  const models = await listModels()
  const found = models.find(function (candidate) {
    return candidate.id === model
  })

  if (found == null) {
    return null
  }

  caches.flash.set(key, found)

  return found
}

// Whether `model` can see images (Lemonade labels it "vision")
export const modelSeesImages = async function (model) {
  const found = await findModel(model)
  return found != null && hasLabel(found, `vision`)
}

// Whether `model` is trained to be told what a search is for (prompts.embeddings): a
// Qwen3-Embedding model. Lemonade has no label for that, so they're known by name, or by their
// checkpoint for one pulled under a name of its own (e.g. "user.Qwen3-Embed-8B").
export const takesQueryInstructions = async function (model) {
  const found = await findModel(model)
  return found != null && /qwen3-embedding/i.test(`${found.id} ${found.checkpoint ?? ``}`)
}

// Starts a streamed chat completion and returns the upstream Response, whose body is a
// server-sent event stream of "data: {...}" lines ending with "data: [DONE]".
// Lemonade has slowRequestLimit to start replying, which covers loading the model; once the
// stream begins, a long reply can keep going. Pass `signal` to cancel it, e.g. when the browser
// disconnects. `tools` are OpenAI-style function definitions.
export const streamChat = async function ({ model, messages, tools = [], signal }) {
  const url = `${config.lemonade.host}/api/v1/chat/completions`

  const payload = {
    model,
    messages,
    stream: true,
  }

  if (tools.length > 0) {
    payload.tools = tools
  }

  // Only waiting for the reply to start is limited, so the timer stops once fetch resolves
  const startLimit = new AbortController()
  const startTimer = setTimeout(function () {
    startLimit.abort(new Error(`Lemonade didn't start replying within ${slowRequestLimit / 60000} minutes`))
  }, slowRequestLimit)

  let response = null

  try {
    response = await fetch(url, {
      method: `POST`,
      headers: getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.any([signal, startLimit.signal]),
      timeout: false,
    })
  } finally {
    clearTimeout(startTimer)
  }

  if (response.ok === false) {
    throw await failure(`chat`, response)
  }

  return response
}

const titleTimeout = 1000 * 60
const titleSourceLimit = 2000

// Asks the model for a few-word title summarizing the start of a conversation
export const writeTitle = async function ({ model, userText, replyText }) {
  const url = `${config.lemonade.host}/api/v1/chat/completions`

  const conversation = [
    `User: ${userText.slice(0, titleSourceLimit)}`,
    `Assistant: ${replyText.slice(0, titleSourceLimit)}`,
  ].join(`\n\n`)

  const payload = {
    model,
    max_tokens: 40,
    // Thinking models answer much faster without reasoning first; a title doesn't need it
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      {
        role: `system`,
        content: prompts.chat.title,
      },
      { role: `user`, content: conversation },
    ],
  }

  const response = await fetch(url, {
    method: `POST`,
    headers: getHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(titleTimeout),
  })

  if (response.ok === false) {
    throw await failure(`title`, response)
  }

  const body = await response.json()
  const rawTitle = body.choices?.[0]?.message?.content ?? ``

  // Models sometimes wrap the title in quotes or end it with a period anyway
  let title = rawTitle.trim()
  title = title.replace(/^["'“”‘’*#\s]+/, ``)
  title = title.replace(/["'“”‘’*.\s]+$/, ``)
  title = title.replace(/\s+/g, ` `)
  title = title.slice(0, 80)

  if (title === ``) {
    throw new Error(`Lemonade title was empty`)
  }

  return title
}

// Returns the image as a PNG buffer. `size` is "WIDTHxHEIGHT" (Lemonade rounds each side up to a
// multiple of 64); without it, the model's own default is used. The seed picks the variation;
// the same prompt and seed give the same image. Loading the model and generating can take minutes,
// so the limit is slowRequestLimit; pass `signal` to cancel.
export const generateImage = async function ({ model, prompt, size = null, seed, signal }) {
  const url = `${config.lemonade.host}/api/v1/images/generations`

  const payload = {
    model,
    prompt,
    seed,
    n: 1,
    response_format: `b64_json`,
  }

  if (size != null) {
    payload.size = size
  }

  const response = await fetch(url, {
    method: `POST`,
    headers: getHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.any([signal, AbortSignal.timeout(slowRequestLimit)]),
    timeout: false,
  })

  if (response.ok === false) {
    throw await failure(`image`, response)
  }

  const body = await response.json()
  const imageBase64 = body.data?.[0]?.b64_json

  if (imageBase64 == null) {
    throw new Error(`Lemonade image response had no image`)
  }

  const pngBuffer = Buffer.from(imageBase64, `base64`)

  return pngBuffer
}

// Each of `inputs` (strings) as a vector, an array of numbers, in the same order. Loading the
// model can take a while the first time, so the limit is slowRequestLimit; pass `signal` to cancel.
export const embed = async function ({ model, inputs, signal }) {
  const url = `${config.lemonade.host}/api/v1/embeddings`

  const payload = {
    model,
    input: inputs,
  }

  const response = await fetch(url, {
    method: `POST`,
    headers: getHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.any([signal, AbortSignal.timeout(slowRequestLimit)]),
    timeout: false,
  })

  if (response.ok === false) {
    throw await failure(`embeddings`, response)
  }

  const body = await response.json()
  const items = body.data ?? []

  if (items.length !== inputs.length) {
    throw new Error(`Lemonade embeddings gave ${items.length} vectors for ${inputs.length} texts`)
  }

  // Each item says which input it's for; put them back in that order
  const vectors = []

  for (const item of items) {
    vectors[item.index] = item.embedding
  }

  return vectors
}

// A MinerU-HTML `model`'s labels for a page's blocks (`html`, from ai-tools/mainContent.js), as
// it answers them, e.g. "<answer>1main2other</answer>", read without sampling. Returns
// { text, isCutOff }, isCutOff being true when it stopped before the end: MinerU-HTML allows up
// to 8 tokens for each of the `blockCount` blocks. Loading the model and reading a big page can
// take a while, so the limit is slowRequestLimit; pass `signal` to cancel.
export const labelHTML = async function ({ model, html, blockCount, signal }) {
  const url = `${config.lemonade.host}/api/v1/chat/completions`

  const payload = {
    model,
    temperature: 0,
    max_tokens: blockCount * 8 + 64,
    messages: [{ role: `user`, content: prompts.pageReader.mineru({ html }) }],
  }

  const response = await fetch(url, {
    method: `POST`,
    headers: getHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.any([signal, AbortSignal.timeout(slowRequestLimit)]),
    timeout: false,
  })

  if (response.ok === false) {
    throw await failure(`page reader`, response)
  }

  const body = await response.json()
  const choice = body.choices?.[0]

  return { text: (choice?.message?.content ?? ``).trim(), isCutOff: choice?.finish_reason === `length` }
}

export default {
  listModels,
  getHealth,
  getStats,
  getSystemInfo,
  hasLabel,
  isPageReaderModel,
  listChatModels,
  listImageModels,
  listEmbeddingModels,
  findModel,
  modelSeesImages,
  takesQueryInstructions,
  streamChat,
  writeTitle,
  generateImage,
  embed,
  labelHTML,
}
