import dayjs from 'dayjs'
import joi from '../../../lib/joi.js'
import users from '../../../lib/users.js'
import usage from '../../../lib/usage.js'
import briefings from '../../../services/briefings.js'

// Admin → Users: everyone with an account, what rook holds for each, and when their briefings ran
// and are next due; a form to add one, and each user's own actions (the routes in [id]). Admins
// only (see middleware/metaRouter.js).

// The page, with the add form open and holding `adding` when a try at it failed
const render = function (ctx, adding = null) {
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

  ctx.body = ctx.nunjucks(`admin/users`, { userRows, totals, adding, passwordMinLength: users.passwordMinLength })
}

export const GET = async function (ctx) {
  render(ctx)
}

// Adds a user. A slip keeps the form open with the name, email and admin choice, never the password.
export const POST = async function (ctx) {
  const body = ctx.request.body ?? {}
  const kept = { name: body.name ?? ``, email: body.email ?? ``, isAdmin: body.isAdmin != null }
  let args

  try {
    args = await joi.object({
      name: joi.string().trim().max(200).required(),
      email: joi.string().trim().email({ tlds: false }).required(),
      password: joi.string().min(users.passwordMinLength).required(),
      confirm: joi.string().required(),
      isAdmin: joi.any(),
    }).validateAsync(body, { stripUnknown: true })
  } catch (e) {
    ctx.addFlash(e.message, `error`)
    return render(ctx, kept)
  }

  if (args.password !== args.confirm) {
    ctx.addFlash(`The passwords don't match.`, `error`)
    return render(ctx, kept)
  }

  if (users.findLogin(args.email) != null) {
    ctx.addFlash(`There's already a user with the email ${args.email}.`, `error`)
    return render(ctx, kept)
  }

  const user = await users.createUser({ name: args.name, email: args.email, password: args.password, isAdmin: kept.isAdmin })

  ctx.addFlash(`Added ${user.name}${user.isAdmin ? ` as an admin` : ``}. They log in with ${user.email} and the password.`, `success`)
  return ctx.redirect(`/admin/users`)
}
