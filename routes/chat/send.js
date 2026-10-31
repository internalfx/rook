
import { PassThrough } from 'node:stream'
import joi from '../../services/joi.js'
import lemonade from '../../services/lemonade.js'
import chats from '../../services/chats.js'
import settings from '../../services/settings.js'
import tools from '../../services/tools.js'

// How many replies the model gets per message, counting the ones after each round of tool calls.
// Every round offers the same tools (changing them would change the prompt); tool calls in the
// last round are answered as not run.
const maxRounds = 5

// Used when the model can't write a title: the start of the first message
const fallbackTitle = function (text) {
  const firstLine = text.trim().split(`\n`)[0]

  if (firstLine.length <= 60) {
    return firstLine
  }

  return `${firstLine.slice(0, 57)}…`
}

const createTitle = async function ({ model, userText, replyText }) {
  try {
    const title = await lemonade.writeTitle({ model, userText, replyText })
    return title
  } catch (err) {
    console.error(err)
    return fallbackTitle(userText)
  }
}

// A saved message => the OpenAI message format the model expects
const toModelMessage = function (message) {
  if (message.role === `tool`) {
    return { role: `tool`, tool_call_id: message.toolCallId, content: message.content }
  }

  if (message.role === `assistant` && message.toolCalls != null) {
    return { role: `assistant`, content: message.content, tool_calls: message.toolCalls }
  }

  return { role: message.role, content: message.content }
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
// call is run and that's the result of each. Returns true when the user stopped.
const runToolCalls = async function ({ toolCalls, chat, history, sendEvent, abort, titleNotes, skipReason = null }) {
  for (const call of toolCalls) {
    const name = call.function.name
    const argumentsText = call.function.arguments
    const prompt = tools.readImagePrompt(argumentsText)

    sendEvent({ type: `toolCall`, toolCallId: call.id, name, prompt })

    let result = null

    if (skipReason != null) {
      result = { content: skipReason, imageId: null }
    } else if (abort.signal.aborted === true) {
      result = { content: `The user stopped this before it ran.`, imageId: null }
    } else {
      try {
        result = await tools.runTool({ name, argumentsText, chatTools: chat.tools, signal: abort.signal })
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

// Streams the model's replies to the browser as rook's own events, one JSON object per
// "data:" line, and saves each message as it completes:
//   { type: "assistant" }                                 a new reply from the model begins
//   { type: "reasoning" | "content", text }               more of that reply
//   { type: "toolCall", toolCallId, name, prompt }        the model asked for a tool
//   { type: "toolResult", toolCallId, content, imageId }  the tool finished
//   { type: "title", title }                              a new chat's title
//   { type: "error", message }
// After tool calls the model is asked again, so it can answer with the results in hand.
// The chat's own model and tools are used throughout.
const runConversation = async function ({ firstUpstream, history, chat, userText, output, abort }) {
  const model = chat.model
  const toolDefinitions = tools.getToolDefinitions(chat.tools)

  const sendEvent = function (event) {
    if (output.writable) {
      output.write(`data: ${JSON.stringify(event)}\n\n`)
    }
  }

  // What the model said and drew, for writing the chat's title
  const titleNotes = []

  let upstream = firstUpstream

  try {
    for (let round = 1; round <= maxRounds; round += 1) {
      if (upstream == null) {
        try {
          upstream = await lemonade.streamChat({ model, messages: history, tools: toolDefinitions, signal: abort.signal })
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
        const skipReason = `Not run: the limit of tool calls for one message was reached.`
        await runToolCalls({ toolCalls, chat, history, sendEvent, abort, titleNotes, skipReason })
        break
      }

      const stopped = await runToolCalls({ toolCalls, chat, history, sendEvent, abort, titleNotes })

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
    output.end()
  }
}

// Sends one message in a chat and streams the reply back (see runConversation). Without a
// chatId, a new chat is created; its id is returned in the X-Chat-Id header. The history comes
// from the database, and the Lemonade API key never leaves the server.
export const POST = async function (ctx) {
  let args

  try {
    args = await joi.object({
      chatId: joi.string(),
      content: joi.string().trim().required(),
    }).validateAsync(ctx.request.body)
  } catch (err) {
    ctx.throw(400, err.message)
  }

  let chat = null
  let model = null
  let chatTools = null
  let history = []

  // A chat keeps the model and tools it was created with, so its prompt never changes under it;
  // Settings only decide what a new chat starts with
  if (args.chatId == null) {
    model = settings.get(`chatModel`)
    chatTools = tools.toolsFromSettings()

    if (model == null) {
      ctx.throw(400, `Choose a chat model in Settings first.`)
    }
  } else {
    chat = chats.getChat(args.chatId)

    if (chat == null) {
      ctx.throw(404, `That chat no longer exists.`)
    }

    model = chat.model
    chatTools = chat.tools

    const savedMessages = chats.getMessages(chat.id)
    history = savedMessages.map(toModelMessage)
  }

  history.push({ role: `user`, content: args.content })

  // Stop generating if the browser goes away (Stop button, closed tab, navigation)
  const abort = new AbortController()

  ctx.res.on(`close`, function () {
    const finishedNormally = ctx.res.writableFinished === true

    if (finishedNormally === false) {
      abort.abort()
    }
  })

  // Throws before anything is saved if Lemonade refuses the request
  const firstUpstream = await lemonade.streamChat({
    model,
    messages: history,
    tools: tools.getToolDefinitions(chatTools),
    signal: abort.signal,
  })

  if (chat == null) {
    chat = chats.createChat({ model, tools: chatTools })
  }

  chats.addMessage({ chatId: chat.id, role: `user`, content: args.content })
  chats.touchChat(chat.id)

  // Koa pipes a web ReadableStream body without an error handler, so an aborted or failed
  // upstream would crash the process. runConversation writes into this stream instead.
  const output = new PassThrough()

  runConversation({ firstUpstream, history, chat, userText: args.content, output, abort })

  ctx.set(`X-Chat-Id`, chat.id)
  ctx.set(`Content-Type`, `text/event-stream`)
  ctx.set(`Cache-Control`, `no-cache`)
  ctx.body = output
}
