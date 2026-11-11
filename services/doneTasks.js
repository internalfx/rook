import db from '../lib/db.js'
import { doneKeptDays } from '../lib/tasks.js'
import taskRequests from '../lib/taskRequests.js'

// Deletes the tasks done long enough ago; how long is doneKeptDays in lib/tasks.js, which the
// Tasks page also shows. Task requests between users (lib/taskRequests.js) that were settled that
// long ago go with them. Run on the hour by cron.js.

const deleteOldDoneRows = db.query(`DELETE FROM tasks WHERE doneAt IS NOT NULL AND doneAt < $before`)

// Deletes every user's tasks done more than doneKeptDays ago, and returns how many went. Open
// tasks are never touched: putting a done task back on the list clears its doneAt.
export const deleteOldDone = function () {
  const keptMs = 1000 * 60 * 60 * 24 * doneKeptDays
  const beforeDate = new Date(Date.now() - keptMs)
  const before = beforeDate.toISOString()

  // First, while a request can still be matched to its done task
  taskRequests.deleteOld(beforeDate)

  const result = deleteOldDoneRows.run({ before })

  return result.changes
}

export default {
  deleteOldDone,
}
