import joi from '../../../../lib/joi.js'
import users from '../../../../lib/users.js'

// Admin → Users → a user's new password. Their browsers stay logged in.

const render = function (ctx, user) {
  ctx.body = ctx.nunjucks(`admin/userPassword`, { user, passwordMinLength: users.passwordMinLength })
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

  await users.setPassword(user.id, args.password)

  ctx.addFlash(`Password changed for ${user.name}. They stay logged in where they are.`, `success`)
  return ctx.redirect(`/admin/users`)
}
