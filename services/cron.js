import cron from 'node-cron'
import briefings from './briefings.js'
import notificationChecks from './notificationChecks.js'
import requestReviews from './requestReviews.js'
import doneTasks from './doneTasks.js'

// Scheduled jobs, keyed by name
const jobs = {}

// Starts a scheduled briefing when one is due; how often is set in Admin → Briefings (see runIfDue)
jobs.briefing = cron.schedule(`* * * * *`, function () {
  try {
    briefings.runIfDue()
  } catch (err) {
    console.error(`Briefing schedule failed`, err)
  }
})

// Checks and sends the scheduled notifications that are due
jobs.notifications = cron.schedule(`* * * * *`, function () {
  notificationChecks.sendDue().catch(function (err) {
    console.error(`Sending scheduled notifications failed`, err)
  })
})

// Has the model look at the task requests users have sent each other
jobs.requestReviews = cron.schedule(`* * * * *`, function () {
  requestReviews.reviewWaiting().catch(function (err) {
    console.error(`Reviewing task requests failed`, err)
  })
})

// On the hour, deletes the tasks done more than doneKeptDays (lib/tasks.js) ago, and the task
// requests settled that long ago
jobs.doneTasks = cron.schedule(`0 * * * *`, function () {
  try {
    doneTasks.deleteOldDone()
  } catch (err) {
    console.error(`Deleting old done tasks failed`, err)
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
