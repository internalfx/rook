import dayjs from 'dayjs'
import briefings from '../../services/briefings.js'

// A briefing as the page shows it: when it ran, in words, and how many tools it called
const toPageBriefing = function (briefing) {
  const started = dayjs(briefing.startedAt)

  const toolMessages = briefing.transcript.filter(function (message) {
    return message.role === `tool`
  })

  return {
    ...briefing,
    when: started.format(`dddd D MMMM, h:mm A`),
    ago: started.fromNow(),
    stepCount: toolMessages.length,
  }
}

// Every briefing's transcript, keyed by its id, for drawing "What it did" as a chat is drawn.
// It goes in a <script> tag, so "<" is escaped to keep the text from closing it early.
const buildTranscriptsJSON = function (briefingList) {
  const transcripts = {}

  for (const briefing of briefingList) {
    transcripts[briefing.id] = briefing.transcript
  }

  return JSON.stringify(transcripts).replace(/</g, `\\u003c`)
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

  const shown = latest == null ? earlier : [latest, ...earlier]

  ctx.body = ctx.nunjucks(`briefing/index`, {
    latest: latest == null ? null : toPageBriefing(latest),
    earlier: earlier.map(toPageBriefing),
    transcriptsJSON: buildTranscriptsJSON(shown),
    isRunning: briefings.isRunning(),
    nextText,
  })
}
