import dayjs from 'dayjs'
import users from '../../../lib/users.js'
import usage from '../../../lib/usage.js'
import briefings from '../../../services/briefings.js'

// Admin → Users: everyone with an account, what rook holds for each, and when their briefings ran
// and are next due. Adding, editing, a new password and removal each have their own page (new.js
// and [id]). Admins only (see middleware/metaRouter.js).
export const GET = async function (ctx) {
  const byUser = usage.countByUser()
  const now = Date.now()

  const userRows = users.listUsers().map(function (user) {
    const counts = usage.countsFor(byUser, user.id)
    const nextDue = briefings.getNextDue(user.id)

    return {
      ...user,
      ...counts,
      lastBriefing: counts.lastBriefingAt == null ? null : dayjs(counts.lastBriefingAt).fromNow(),
      nextBriefing: nextDue == null ? null : (nextDue.getTime() <= now ? `due now` : dayjs(nextDue).fromNow()),
    }
  })

  const totals = { chats: 0, messages: 0, memories: 0, openTasks: 0, doneTasks: 0, briefings: 0, notifications: 0, waiting: 0 }

  for (const row of userRows) {
    for (const key of Object.keys(totals)) {
      totals[key] += row[key]
    }
  }

  ctx.body = ctx.nunjucks(`admin/users`, { userRows, totals })
}
