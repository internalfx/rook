import dayjs from 'dayjs'
import briefings from '../../services/briefings.js'

// How long something took, e.g. "45 s", "1 min 37 s", or "1 h 3 min" once it's an hour or more
const describeDuration = function (ms) {
  const totalSeconds = Math.round(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours} h ${minutes} min`
  }

  if (minutes > 0) {
    return `${minutes} min ${seconds} s`
  }

  return `${seconds} s`
}

// A briefing as the page shows it: when it ran, in words, how long it took, and how many tools it
// called. Only a finished one has a time: one that failed when the server restarted was marked
// finished at the restart, which can be long after it stopped.
const toPageBriefing = function (briefing) {
  const started = dayjs(briefing.startedAt)

  const toolMessages = briefing.transcript.filter(function (message) {
    return message.role === `tool`
  })

  let took = null

  if (briefing.status === `done` && briefing.finishedAt != null) {
    const finished = dayjs(briefing.finishedAt)
    took = describeDuration(finished.diff(started))
  }

  return {
    ...briefing,
    when: started.format(`dddd D MMMM, h:mm A`),
    ago: started.fromNow(),
    took,
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
  // Only one earlier briefing is kept (see keptBriefings in services/briefings.js)
  const earlier = briefings.listEarlier(1)
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
