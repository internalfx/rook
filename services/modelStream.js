// Reading a streamed reply from the model (lemonade.streamChat), for chats (routes/chat/send.js)
// and briefings (services/briefings.js)

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

// Reads one streamed reply from the model, passing its text on as rook's own events as it
// arrives. Returns what it said and the tools it asked for. `finished` is false when the stream
// was cut short: by `signal` (the user stopping it), or by an error, which is in `error` and is
// also sent as an { type: "error" } event.
export const readModelReply = async function ({ upstream, sendEvent, signal }) {
  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()

  let buffer = ``
  let content = ``
  let reasoning = ``
  let finished = false
  let error = null
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
    const weAborted = signal.aborted === true

    if (weAborted === false) {
      console.error(`Lemonade stream failed`, err)
      error = `The reply failed: ${err.message}`
      sendEvent({ type: `error`, message: error })
    }
  }

  // Indexes can skip numbers; keep only the calls that arrived
  const completeToolCalls = toolCalls.filter(function (call) {
    return call != null
  })

  return { content, reasoning, toolCalls: completeToolCalls, finished, error }
}

export default {
  readModelReply,
}
