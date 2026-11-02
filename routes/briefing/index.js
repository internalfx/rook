import dayjs from 'dayjs'
import briefings from '../../services/briefings.js'

// A briefing as the page shows it: when it ran, in words
const toPageBriefing = function (briefing) {
  const started = dayjs(briefing.startedAt)

  return {
    ...briefing,
    when: started.format(`dddd D MMMM, h:mm A`),
    ago: started.fromNow(),
  }
}

export const GET = async function (ctx) {
  const latest = briefings.getLatest()
  const earlier = briefings.listEarlier(10)
  const nextDue = briefings.getNextDue()

  // Before rendering, so this page's own nav item doesn't show the dot
  briefings.markViewed()

  // "in 3 hours", or null while scheduled briefings are off
  let nextText = null

  if (nextDue != null) {
    const isDue = nextDue.getTime() <= Date.now()
    nextText = isDue ? `due now` : dayjs(nextDue).fromNow()
  }

  ctx.body = ctx.nunjucks(`briefing/index`, {
    latest: latest == null ? null : toPageBriefing(latest),
    earlier: earlier.map(toPageBriefing),
    isRunning: briefings.isRunning(),
    nextText,
  })
}
