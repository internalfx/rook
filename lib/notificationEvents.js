import { PassThrough } from 'node:stream'

// Notifications as they're sent, streamed to each of the user's open rook pages, so the page can
// pop them up on the desktop while rook is open (see templates/layouts/default.njk). Nothing is
// kept: a page that isn't open when one is sent never hears of it. That's on purpose: when rook
// isn't running, the phone (ntfy) is where notifications go.

// How often to send a keep-alive line while nothing else is sent, as for runs (lib/runs.js), so
// the proxy or browser doesn't drop an idle connection
const keepAliveInterval = 1000 * 15

// userId => Set of the PassThrough streams open to that user's pages
const watchers = new Map()

// Streams this request's page each notification sent to the user, until the page goes away
export const watch = function (ctx, userId) {
  // A PassThrough rather than a web ReadableStream, so an aborted connection can't crash the
  // process (see lib/watchRunResponse.js)
  const output = new PassThrough()

  if (watchers.has(userId) === false) {
    watchers.set(userId, new Set())
  }

  watchers.get(userId).add(output)

  const keepAlive = setInterval(function () {
    if (output.writable) {
      output.write(`: keep-alive\n\n`)
    }
  }, keepAliveInterval)

  ctx.res.on(`close`, function () {
    clearInterval(keepAlive)

    const set = watchers.get(userId)

    if (set != null) {
      set.delete(output)

      if (set.size === 0) {
        watchers.delete(userId)
      }
    }
  })

  ctx.set(`Content-Type`, `text/event-stream`)
  ctx.set(`Cache-Control`, `no-cache`)
  ctx.set(`X-Accel-Buffering`, `no`)
  ctx.body = output

  // Sent at once, so the browser sees the stream open rather than waiting for the first event
  output.write(`: connected\n\n`)
}

// Tells each of the user's open pages about a notification just sent ({ id, title, message,
// priority }). It never throws.
export const publish = function (userId, notification) {
  const set = watchers.get(userId)

  if (set == null) {
    return
  }

  const line = `event: notification\ndata: ${JSON.stringify(notification)}\n\n`

  for (const output of set) {
    try {
      if (output.writable) {
        output.write(line)
      }
    } catch (err) {}
  }
}

export default {
  watch,
  publish,
}
