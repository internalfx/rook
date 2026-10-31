
// import cron from 'node-cron'

// Scheduled jobs, keyed by name, e.g.
// jobs.example = cron.schedule(`0 * * * *`, async function () { ... })
const jobs = {}

const stopAll = function () {
  for (const job of Object.values(jobs)) {
    job.stop()
  }
}

export default {
  stopAll,
}
