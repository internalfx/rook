
import config from '../configure.js'

// Lemonade Server: an OpenAI-compatible API for local models
// https://lemonade-server.ai

const requestTimeout = 1000 * 10

const getHeaders = function () {
  return {
    Authorization: `Bearer ${config.lemonade.apikey}`,
    'Content-Type': `application/json`,
  }
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

// Lemonade labels each model with what it can do, e.g. "chat", "image", "tts", "tool-calling"
export const hasLabel = function (model, label) {
  const labels = model.labels ?? []
  return labels.includes(label)
}

// Models that can hold a conversation, e.g. not image or speech models
export const listChatModels = async function () {
  const models = await listModels()

  const chatModels = models.filter(function (model) {
    return hasLabel(model, `chat`)
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

// Starts a streamed chat completion and returns the upstream Response, whose body is a
// server-sent event stream of "data: {...}" lines ending with "data: [DONE]".
// There is no timeout: the first reply can wait for the model to load. Pass `signal`
// to cancel it, e.g. when the browser disconnects. `tools` are OpenAI-style function definitions.
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

  const response = await fetch(url, {
    method: `POST`,
    headers: getHeaders(),
    body: JSON.stringify(payload),
    signal,
  })

  if (response.ok === false) {
    const errorText = await response.text()
    throw new Error(`Lemonade chat failed: ${response.status} ${errorText}`)
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
        content: `Write a short title, at most 6 words, summarizing this conversation. Reply with only the title, no quotes or punctuation at the end.`,
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
    const errorText = await response.text()
    throw new Error(`Lemonade title failed: ${response.status} ${errorText}`)
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

// Returns the image as a PNG buffer. The model's own defaults (size, steps) are used.
// There is no timeout, since loading the model and generating can take a while; pass `signal` to cancel.
export const generateImage = async function ({ model, prompt, signal }) {
  const url = `${config.lemonade.host}/api/v1/images/generations`

  const payload = {
    model,
    prompt,
    n: 1,
    response_format: `b64_json`,
  }

  const response = await fetch(url, {
    method: `POST`,
    headers: getHeaders(),
    body: JSON.stringify(payload),
    signal,
  })

  if (response.ok === false) {
    const errorText = await response.text()
    throw new Error(`Lemonade image failed: ${response.status} ${errorText}`)
  }

  const body = await response.json()
  const imageBase64 = body.data?.[0]?.b64_json

  if (imageBase64 == null) {
    throw new Error(`Lemonade image response had no image`)
  }

  const pngBuffer = Buffer.from(imageBase64, `base64`)

  return pngBuffer
}

export default {
  listModels,
  hasLabel,
  listChatModels,
  listImageModels,
  streamChat,
  writeTitle,
  generateImage,
}
