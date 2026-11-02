import joi from '../../services/joi.js'
import lemonade from '../../services/lemonade.js'
import chats from '../../services/chats.js'
import images from '../../services/images.js'
import settings from '../../services/settings.js'
import tools from '../../ai-tools/index.js'
import runs from '../../services/runs.js'
import { watchRunResponse } from '../../lib/watchRunResponse.js'
import { maxCallsPerTool, maxRounds, describeCallLimit } from '../../ai-tools/limits.js'
import config from '../../configure.js'
import prompts from '../../prompts.js'

// Every round of a reply offers the same tools (changing them would change the prompt); see
// ai-tools/limits.js for how many calls and rounds it gets.

// Said for the user before a conversation the model started (from a briefing), for
// the model only. Some models' chat templates refuse a conversation that doesn't start with the
// user.
const briefingOpener = prompts.chat.briefingOpener

// The most images one message can carry, and the most the model is shown at once: those in the
// latest messages. Older ones become a line saying they were there, so a long chat with photos
// stays fast and within the model's context.
const maxImagesPerMessage = 4
const maxSentImages = 4

// An attached image's size, decoded; the chat page shrinks them well below this
const maxImageBytes = 5 * 1024 * 1024

// The chat page sends every image as a JPEG, whatever it was (see shrinkImage there)
const jpegDataUrlStart = `data:image/jpeg;base64,`

// What every chat starts with: the chat prompt, then the pinned memories. One system message,
// since some models' chat templates only accept one, as briefings do. Null when both are empty.
const buildSystemMessage = function () {
  const parts = []
  const prompt = prompts.chat.system({ appName: config.appName, ownerName: config.owner.name }).trim()

  if (prompt !== ``) {
    parts.push(prompt)
  }

  const memoriesMessage = tools.buildMemoriesMessage()

  if (memoriesMessage != null) {
    parts.push(memoriesMessage.content)
  }

  if (parts.length === 0) {
    return null
  }

  return { role: `system`, content: parts.join(`\n\n`) }
}

// Used when the model can't write a title: the start of the first message, or "Image" for one
// that's only images
const fallbackTitle = function (text) {
  const firstLine = text.trim().split(`\n`)[0]

  if (firstLine === ``) {
    return `Image`
  }

  if (firstLine.length <= 60) {
    return firstLine
  }

  return `${firstLine.slice(0, 57)}…`
}

const createTitle = async function ({ model, userText, replyText }) {
  try {
    const title = await lemonade.writeTitle({ model, userText: userText || prompts.chat.imageOnlyMessage, replyText })
    return title
  } catch (err) {
    console.error(err)
    return fallbackTitle(userText)
  }
}

// A saved message => the OpenAI message format the model expects. A user message's images are
// added by toModelHistory.
const toModelMessage = function (message) {
  if (message.role === `tool`) {
    return { role: `tool`, tool_call_id: message.toolCallId, content: message.content }
  }

  if (message.role === `assistant` && message.toolCalls != null) {
    return { role: `assistant`, content: message.content, tool_calls: message.toolCalls }
  }

  return { role: message.role, content: message.content }
}

// A user message with images => its text, then each image: as an image part while it's in
// `shownIds`, otherwise as a line saying it was there. Only text, when none is shown, for models
// that don't take image parts.
const toModelMessageWithImages = async function (message, { shownIds, seesImages }) {
  const parts = []

  if (message.content !== ``) {
    parts.push({ type: `text`, text: message.content })
  }

  for (const id of message.imageIds) {
    const dataUrl = shownIds.has(id) ? await images.readImageDataUrl(id) : null

    if (dataUrl != null) {
      parts.push({ type: `image_url`, image_url: { url: dataUrl } })
    } else {
      parts.push({ type: `text`, text: seesImages ? prompts.chat.olderImage : prompts.chat.unseenImage })
    }
  }

  const hasImage = parts.some(function (part) {
    return part.type === `image_url`
  })

  if (hasImage === false) {
    const lines = parts.map(function (part) {
      return part.text
    })

    return { role: `user`, content: lines.join(`\n`) }
  }

  return { role: `user`, content: parts }
}

// The saved conversation => what the model is sent. The maxSentImages most recent images go as
// images, when the model can see; older ones, and all of them when it can't, as a line each.
const toModelHistory = async function (savedMessages, { seesImages }) {
  const imageIds = savedMessages.flatMap(function (message) {
    return message.imageIds ?? []
  })

  const shownIds = new Set(seesImages ? imageIds.slice(Math.max(0, imageIds.length - maxSentImages)) : [])
  const history = []

  for (const message of savedMessages) {
    if (message.role === `user` && message.imageIds != null) {
      history.push(await toModelMessageWithImages(message, { shownIds, seesImages }))
    } else {
      history.push(toModelMessage(message))
    }
  }

  return history
}

// The images sent with a message, as data URLs => their JPEG bytes. Returns { buffers }, or
// { problem } saying what's wrong with one.
const readAttachedImages = function (dataUrls) {
  const buffers = []

  for (const dataUrl of dataUrls) {
    if (dataUrl.startsWith(jpegDataUrlStart) === false) {
      return { problem: `Images must be sent as JPEG data URLs.` }
    }

    const buffer = Buffer.from(dataUrl.slice(jpegDataUrlStart.length), `base64`)
    const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff

    if (isJpeg === false) {
      return { problem: `An attached image isn't a JPEG.` }
    }

    if (buffer.length > maxImageBytes) {
      return { problem: `An attached image is over ${maxImageBytes / 1024 / 1024} MB.` }
    }

    buffers.push(buffer)
  }

  return { buffers }
}

// One line of Lemonade's stream => its parsed event, or null for blank lines and "data: [DONE]"
const parseStreamLine = function (line) {
  const trimmed = line.trim()

  if (trimmed.startsWith(`data:`) === false) {
    return null
  }

  const data = trimmed.slice(5).trim()

  if (data === `[DONE]`) {
    return null
  }

  return JSON.parse(data)
}

// Tool calls arrive in pieces: the first carries the id and name, later ones add to the arguments text
const addToolCallPart = function (toolCalls, part) {
  let call = toolCalls[part.index]

  if (call == null) {
    call = { id: ``, type: `function`, function: { name: ``, arguments: `` } }
    toolCalls[part.index] = call
  }

  if (part.id) {
    call.id = part.id
  }

  if (part.function?.name) {
    call.function.name = part.function.name
  }

  if (part.function?.arguments) {
    call.function.arguments += part.function.arguments
  }
}

// Reads one streamed reply from the model, passing its text on to the browser as it arrives.
// Returns what it said and the tools it asked for. `finished` is false when the stream was cut
// short, by the user stopping it or by an error.
const readModelReply = async function ({ upstream, sendEvent, abort }) {
  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()

  let buffer = ``
  let content = ``
  let reasoning = ``
  let finished = false
  const toolCalls = []

  try {
    while (true) {
      const { value, done } = await reader.read()

      if (done) {
        finished = true
        break
      }

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split(`\n`)
      // The last piece may be half a line; keep it for the next chunk
      buffer = lines.pop()

      for (const line of lines) {
        const event = parseStreamLine(line)
        const delta = event?.choices?.[0]?.delta

        if (delta == null) {
          continue
        }

        // Thinking models send their reasoning separately from the answer
        if (delta.reasoning_content) {
          reasoning += delta.reasoning_content
          sendEvent({ type: `reasoning`, text: delta.reasoning_content })
        }

        if (delta.content) {
          content += delta.content
          sendEvent({ type: `content`, text: delta.content })
        }

        if (delta.tool_calls) {
          for (const part of delta.tool_calls) {
            addToolCallPart(toolCalls, part)
          }
        }
      }
    }
  } catch (err) {
    const weAborted = abort.signal.aborted === true

    if (weAborted === false) {
      console.error(`Lemonade stream failed`, err)
      sendEvent({ type: `error`, message: `The reply failed: ${err.message}` })
    }
  }

  // Indexes can skip numbers; keep only the calls that arrived
  const completeToolCalls = toolCalls.filter(function (call) {
    return call != null
  })

  return { content, reasoning, toolCalls: completeToolCalls, finished }
}

// Runs the tools the model asked for and saves each result. Every call gets a result, even when
// it isn't run, since the model expects an answer to each call it made. With `skipReason`, no
// call is run and that's the result of each. `callCounts` holds how many times each tool has been
// called for this message so far, by name, and is added to. Returns true when the user stopped.
const runToolCalls = async function ({ toolCalls, chat, chatTools, history, sendEvent, abort, titleNotes, callCounts, skipReason = null }) {
  for (const call of toolCalls) {
    const name = call.function.name
    const callCount = (callCounts[name] ?? 0) + 1
    callCounts[name] = callCount
    const argumentsText = call.function.arguments
    const prompt = tools.readImagePrompt(argumentsText)
    const url = tools.readToolUrl(argumentsText)
    const query = tools.readSearchQuery(argumentsText)
    const memory = tools.readMemoryContent(argumentsText)
    const taskTitle = tools.readTaskTitle(argumentsText)

    sendEvent({ type: `toolCall`, toolCallId: call.id, name, prompt, url, query, memory, taskTitle })

    let result = null

    if (skipReason != null) {
      result = { content: skipReason, imageId: null }
    } else if (callCount > maxCallsPerTool) {
      result = { content: describeCallLimit(name), imageId: null }
    } else if (abort.signal.aborted === true) {
      result = { content: `The user stopped this before it ran.`, imageId: null }
    } else {
      try {
        result = await tools.runTool({ name, argumentsText, chatTools, chatId: chat.id, signal: abort.signal })
      } catch (err) {
        result = { content: `The user stopped this before it finished.`, imageId: null }
      }
    }

    const toolMessage = {
      chatId: chat.id,
      role: `tool`,
      content: result.content,
      toolCallId: call.id,
      imageId: result.imageId,
    }

    chats.addMessage(toolMessage)
    history.push(toModelMessage(toolMessage))

    sendEvent({ type: `toolResult`, toolCallId: call.id, content: result.content, imageId: result.imageId })

    if (result.imageId != null && prompt != null) {
      titleNotes.push(`(Created an image of: ${prompt})`)
    }
  }

  return abort.signal.aborted === true
}

// Runs the model's replies as rook's own events, sent through `run` to whoever is watching (see
// services/runs.js), and saves each message as it completes:
//   { type: "assistant" }                                 a new reply from the model begins
//   { type: "reasoning" | "content", text }               more of that reply
//   { type: "toolCall", toolCallId, name, prompt, url, query, memory, taskTitle }  the model asked for a tool
//   { type: "toolResult", toolCallId, content, imageId }  the tool finished
//   { type: "title", title }                              a new chat's title
//   { type: "error", message }
// After tool calls the model is asked again, so it can answer with the results in hand.
// The model and tools are Settings' as the message was sent, kept for the whole reply. It runs
// on its own, whether or not a browser is watching, until it finishes or the run is stopped.
const runConversation = async function ({ history, chat, model, chatTools, userText, run }) {
  const toolDefinitions = tools.getToolDefinitions(chatTools)
  const abort = run.abort

  // The chat prompt and pinned memories start the conversation the model sees, but aren't saved
  // with it. Taken once per message, so the start stays the same through every round, even when
  // the model pins a memory part way.
  const systemMessage = buildSystemMessage()

  const sendEvent = function (event) {
    runs.emit(run, event)
  }

  // What the model said and drew, for writing the chat's title
  const titleNotes = []

  // How many times the model has called each tool for this message, by name (see maxCallsPerTool)
  const callCounts = {}

  let upstream = null

  try {
    for (let round = 1; round <= maxRounds; round += 1) {
      if (upstream == null) {
        try {
          // Neither of these is saved: the system message, and the opener in front of a
          // conversation the model started from a briefing
          const startMessages = []

          if (systemMessage != null) {
            startMessages.push(systemMessage)
          }

          if (history[0]?.role === `assistant`) {
            startMessages.push({ role: `user`, content: briefingOpener })
          }

          const messages = [...startMessages, ...history]

          upstream = await lemonade.streamChat({ model, messages, tools: toolDefinitions, signal: abort.signal })
        } catch (err) {
          if (abort.signal.aborted === false) {
            console.error(err)
            sendEvent({ type: `error`, message: err.message })
          }
          break
        }
      }

      sendEvent({ type: `assistant` })

      const reply = await readModelReply({ upstream, sendEvent, abort })
      upstream = null

      // Tool calls cut off part way have incomplete arguments, so they aren't run
      let toolCalls = []

      if (reply.finished === true) {
        toolCalls = reply.toolCalls
      }

      // A reply stopped before any answer text isn't saved
      if (reply.content === `` && toolCalls.length === 0) {
        break
      }

      const assistantMessage = {
        chatId: chat.id,
        role: `assistant`,
        content: reply.content,
        reasoning: reply.reasoning,
        toolCalls: toolCalls.length > 0 ? toolCalls : null,
      }

      chats.addMessage(assistantMessage)
      history.push(toModelMessage(assistantMessage))

      if (reply.content !== ``) {
        titleNotes.push(reply.content)
      }

      if (toolCalls.length === 0) {
        break
      }

      // Out of rounds: the calls still need answers, but there's no next round to use them in
      const isLastRound = round === maxRounds

      if (isLastRound) {
        const skipReason = `Not run: the limit of replies for one message was reached.`
        await runToolCalls({ toolCalls, chat, chatTools, history, sendEvent, abort, titleNotes, callCounts, skipReason })
        break
      }

      const stopped = await runToolCalls({ toolCalls, chat, chatTools, history, sendEvent, abort, titleNotes, callCounts })

      if (stopped === true) {
        break
      }
    }

    chats.touchChat(chat.id)

    if (chat.title == null && titleNotes.length > 0) {
      const replyText = titleNotes.join(`\n\n`)
      const title = await createTitle({ model, userText, replyText })

      chats.setTitle(chat.id, title)
      sendEvent({ type: `title`, title })
    }
  } catch (err) {
    console.error(`Chat conversation failed`, err)
    sendEvent({ type: `error`, message: err.message })
  } finally {
    runs.finishRun(run)
  }
}

// Sends one message in a chat, with up to maxImagesPerMessage images (JPEG data URLs), starts
// the reply running on the server (see runConversation) and streams it back. Without a chatId,
// a new chat is created; its id is returned in the X-Chat-Id header. The history comes from the
// database, and the Lemonade API key never leaves the server.
export const POST = async function (ctx) {
  let args

  try {
    args = await joi.object({
      chatId: joi.string(),
      content: joi.string().trim(),
      images: joi.array().items(joi.string()).max(maxImagesPerMessage).default([]),
    }).validateAsync(ctx.request.body)
  } catch (err) {
    ctx.throw(400, err.message)
  }

  // An empty message comes through as null; it's fine with images
  const text = args.content ?? ``

  if (text === `` && args.images.length === 0) {
    ctx.throw(400, `Write a message or attach an image.`)
  }

  const { buffers, problem } = readAttachedImages(args.images)

  if (problem != null) {
    ctx.throw(400, problem)
  }

  // Every chat uses the models and tools in Settings as they are now
  const model = settings.get(`chatModel`)
  const chatTools = tools.getChatTools()

  if (model == null) {
    ctx.throw(400, `Choose a chat model in Settings first.`)
  }

  let chat = null
  let savedMessages = []

  if (args.chatId != null) {
    chat = chats.getChat(args.chatId)

    if (chat == null) {
      ctx.throw(404, `That chat no longer exists.`)
    }

    if (runs.getRun(chat.id) != null) {
      ctx.throw(409, `This chat is still replying.`)
    }

    savedMessages = chats.getMessages(chat.id)
  }

  // Lemonade is only asked whether the model can see when there are images to show it
  const hasImages = buffers.length > 0 || savedMessages.some(function (message) {
    return message.imageIds != null
  })

  let seesImages = false

  if (hasImages) {
    try {
      seesImages = await lemonade.modelSeesImages(model)
    } catch (err) {
      // Without new images the chat carries on, its images as lines of text
      if (buffers.length > 0) {
        ctx.throw(502, `Couldn't check whether the chat model can see images: ${err.message}`)
      }
    }
  }

  if (buffers.length > 0 && seesImages === false) {
    ctx.throw(400, `This chat model can't see images. Choose one that can in Settings.`)
  }

  if (chat == null) {
    chat = chats.createChat()
  }

  const imageIds = []

  for (const buffer of buffers) {
    imageIds.push(await images.saveUpload(buffer))
  }

  chats.addMessage({ chatId: chat.id, role: `user`, content: text, imageIds })
  chats.touchChat(chat.id)

  // Everything up to and including this message is saved; the run's events draw the rest
  const history = await toModelHistory(chats.getMessages(chat.id), { seesImages })
  const run = runs.startRun({ chatId: chat.id, baseCount: history.length })

  runConversation({ history, chat, model, chatTools, userText: text, run })

  ctx.set(`X-Chat-Id`, chat.id)
  watchRunResponse(ctx, run)
}
