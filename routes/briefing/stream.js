import briefings from '../../services/briefings.js'
import { watchRunResponse } from '../../lib/watchRunResponse.js'

// Watches the user's running briefing for the Briefing page: every event so far, then live ones,
// as a chat's reply is watched (see routes/chat/[id]/stream.js). If none is running (it finished
// in the meantime), the only event is { type: "finished" }, and the page reloads to show it.
export const GET = async function (ctx) {
  const run = briefings.getRun(ctx.state.user.id)

  if (run == null) {
    ctx.set(`Content-Type`, `text/event-stream`)
    ctx.set(`Cache-Control`, `no-cache`)
    ctx.body = `data: ${JSON.stringify({ type: `finished` })}\n\n`
    return
  }

  watchRunResponse(ctx, run)
}
