
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

// Models that can hold a conversation, e.g. not image or speech models
export const listChatModels = async function () {
  const models = await listModels()

  const chatModels = models.filter(function (model) {
    const labels = model.labels ?? []
    return labels.includes(`chat`)
  })

  return chatModels
}

// Starts a streamed chat completion and returns the upstream Response, whose body is a
// server-sent event stream of "data: {...}" lines ending with "data: [DONE]".
// There is no timeout: the first reply can wait for the model to load. Pass `signal`
// to cancel it, e.g. when the browser disconnects.
export const streamChat = async function ({ model, messages, signal }) {
  const url = `${config.lemonade.host}/api/v1/chat/completions`

  const payload = {
    model,
    messages,
    stream: true,
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

export default {
  listModels,
  listChatModels,
  streamChat,
}
