import joi from '../../../../lib/joi.js'
import users from '../../../../lib/users.js'

// Admin → Users → a user's new password. Someone else's is temporary: their browsers are logged
// out, and after logging in with it they're made to choose their own. The admin's own is simply
// changed, and they stay logged in.

const render = function (ctx, user) {
  const isSelf = user.id === ctx.state.user.id

  ctx.body = ctx.nunjucks(`admin/userPassword`, { user, isSelf, passwordMinLength: users.passwordMinLength })
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

  let args

  try {
    args = await joi.object({
      password: joi.string().min(users.passwordMinLength).required(),
      confirm: joi.string().required(),
    }).validateAsync(ctx.request.body ?? {}, { stripUnknown: true })
  } catch (e) {
    ctx.addFlash(e.message, `error`)
    return render(ctx, user)
  }

  if (args.password !== args.confirm) {
    ctx.addFlash(`The passwords don't match.`, `error`)
    return render(ctx, user)
  }

  if (user.id === ctx.state.user.id) {
    await users.setPassword(user.id, args.password)

    ctx.addFlash(`Your password was changed.`, `success`)
    return ctx.redirect(`/admin/users`)
  }

  await users.setTemporaryPassword(user.id, args.password)

  ctx.addFlash(`Password changed for ${user.name}. They've been logged out, and will choose their own the next time they log in.`, `success`)
  return ctx.redirect(`/admin/users`)
}
