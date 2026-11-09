import joi from '../../../../lib/joi.js'
import users from '../../../../lib/users.js'

// Admin → Users → a user: their name, email and admin status, and removing them (delete.js). An
// admin's own admin status is another admin's to change, so no one takes the last admin away.

const render = function (ctx, user, values = user) {
  ctx.body = ctx.nunjucks(`admin/userEdit`, { user, values, isSelf: user.id === ctx.state.user.id })
}

export const GET = async function (ctx) {
  const user = users.getUser(ctx.state.params.id)

  if (user == null) {
    return ctx.throw(404)
  }

  render(ctx, user)
}

export const POST = async function (ctx) {
  const user = users.getUser(ctx.state.params.id)

  if (user == null) {
    return ctx.throw(404)
  }

  const body = ctx.request.body ?? {}
  const isSelf = user.id === ctx.state.user.id
  const isAdmin = isSelf ? user.isAdmin : body.isAdmin != null
  const kept = { name: body.name ?? ``, email: body.email ?? ``, isAdmin }
  let args

  try {
    args = await joi.object({
      name: joi.string().trim().max(200).required(),
      email: joi.string().trim().email({ tlds: false }).required(),
    }).validateAsync(body, { stripUnknown: true })
  } catch (e) {
    ctx.addFlash(e.message, `error`)
    return render(ctx, user, kept)
  }

  const other = users.findLogin(args.email)

  if (other != null && other.id !== user.id) {
    ctx.addFlash(`There's already a user with the email ${args.email}.`, `error`)
    return render(ctx, user, kept)
  }

  users.updateUser(user.id, args)

  if (isAdmin !== user.isAdmin) {
    users.setAdmin(user.id, isAdmin)
  }

  ctx.addFlash(`Saved.`, `success`)
  return ctx.redirect(`/admin/users`)
}
