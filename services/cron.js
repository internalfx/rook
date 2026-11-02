import cron from 'node-cron'
import briefings from './briefings.js'

// Scheduled jobs, keyed by name
const jobs = {}

// Starts a scheduled briefing when one is due; how often is set in Settings (see runIfDue)
jobs.briefing = cron.schedule(`* * * * *`, function () {
  try {
    briefings.runIfDue()
  } catch (err) {
    console.error(`Briefing schedule failed`, err)
  }
})

const stopAll = function () {
  for (const job of Object.values(jobs)) {
    job.stop()
  }
}

export default {
  stopAll,
}
