import briefings from '../../services/briefings.js'

// Form POST from the Brief me now button. The briefing runs in the background; the page shows
// it running and reloads when it's done.
export const POST = async function (ctx) {
  briefings.startBriefing({ user: ctx.state.user, startedBy: `manual` })

  ctx.redirect(`/briefing`)
}
