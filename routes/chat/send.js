
import { PassThrough, Readable } from 'node:stream'
import joi from '../../services/joi.js'
import lemonade from '../../services/lemonade.js'

// Relays a chat to Lemonade and streams the reply straight back to the browser,
// so the Lemonade API key never leaves the server
export const POST = async function (ctx) {
  let args

  try {
    args = await joi.object({
      model: joi.string().required(),
      messages: joi.array().items(joi.object({
        role: joi.string().valid(`system`, `user`, `assistant`).required(),
        content: joi.string().required(),
      })).min(1).required(),
    }).validateAsync(ctx.request.body)
  } catch (err) {
    ctx.throw(400, err.message)
  }

  // Stop generating if the browser goes away (Stop button, closed tab, navigation)
  const abort = new AbortController()

  ctx.res.on(`close`, function () {
    const finishedNormally = ctx.res.writableFinished === true

    if (finishedNormally === false) {
      abort.abort()
    }
  })

  const upstream = await lemonade.streamChat({
    model: args.model,
    messages: args.messages,
    signal: abort.signal,
  })

  // Koa pipes a web ReadableStream body without an error handler, so an aborted or failed
  // upstream would crash the process. Relay it through a stream whose errors we handle here.
  const source = Readable.fromWeb(upstream.body)
  const output = new PassThrough()

  source.on(`error`, function (err) {
    const weAborted = abort.signal.aborted === true

    if (weAborted === false) {
      console.error(`Lemonade stream failed`, err)
    }

    output.end()
  })

  source.pipe(output)

  ctx.set(`Content-Type`, `text/event-stream`)
  ctx.set(`Cache-Control`, `no-cache`)
  ctx.body = output
}
