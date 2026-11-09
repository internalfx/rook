import joi from '../../../../lib/joi.js'
import users from '../../../../lib/users.js'

// Form POST from a user's Reset password row on Admin → Users. Their browsers stay logged in.
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
    return ctx.redirect(`/admin/users`)
  }

  if (args.password !== args.confirm) {
    ctx.addFlash(`The passwords don't match.`, `error`)
    return ctx.redirect(`/admin/users`)
  }

  await users.setPassword(user.id, args.password)

  ctx.addFlash(`Password changed for ${user.name}. They stay logged in where they are.`, `success`)
  return ctx.redirect(`/admin/users`)
}
