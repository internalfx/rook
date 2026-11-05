import chats from '../../../services/chats.js'
import runs from '../../../services/runs.js'
import { watchRunResponse } from '../../../lib/watchRunResponse.js'

// Watches the chat's reply in progress, for a page opened (or come back to) while it's still
// running: every event so far, then live ones. If it finished in the meantime, the only event
// is { type: "finished" }, and the page reloads to show what was saved. Only the chat's own
// user can watch it.
export const GET = async function (ctx) {
  const chat = chats.getChat(ctx.state.user.id, ctx.state.params.id)

  if (chat == null) {
    ctx.throw(404)
  }

  const run = runs.getRun(chat.id)

  if (run == null) {
    ctx.set(`Content-Type`, `text/event-stream`)
    ctx.set(`Cache-Control`, `no-cache`)
    ctx.body = `data: ${JSON.stringify({ type: `finished` })}\n\n`
    return
  }

  watchRunResponse(ctx, run)
}
