import { PassThrough } from 'node:stream'
import runs from './runs.js'

// Streams `run` to this request's browser (everything so far, then live) until the run ends
// or the browser goes away. Leaving doesn't stop the run.
export const watchRunResponse = function (ctx, run) {
  // Koa pipes a web ReadableStream body without an error handler, so an aborted connection
  // could crash the process; a PassThrough is safe
  const output = new PassThrough()
  const stopWatching = runs.watchRun(run, output)

  ctx.res.on(`close`, stopWatching)

  ctx.set(`Content-Type`, `text/event-stream`)
  ctx.set(`Cache-Control`, `no-cache`)
  ctx.body = output
}

export default watchRunResponse
