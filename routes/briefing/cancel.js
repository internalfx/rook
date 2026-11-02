import briefings from '../../services/briefings.js'

// Form POST from the Cancel briefing button. Waits until the briefing is stopped and saved, so
// the page it redirects to shows it.
export const POST = async function (ctx) {
  await briefings.cancelBriefing()

  ctx.redirect(`/briefing`)
}
