import joi from '../../services/joi.js'
import users from '../../services/users.js'

// The Change password page, its own page so Settings has no password box for browsers to offer
// to save. The current password is asked for, so a browser left logged in can't change it. Other
// browsers stay logged in; to log them out, a user is removed with scripts/users.js.
export const GET = async function (ctx) {
  ctx.body = ctx.nunjucks(`settings/password`)
}

export const POST = async function (ctx) {
  let args

  try {
    args = await joi.object({
      currentPassword: joi.string().required(),
      newPassword: joi.string().min(8).required(),
      confirmPassword: joi.string().required(),
    }).validateAsync(ctx.request.body)
  } catch (err) {
    ctx.addFlash(err.message, `error`)
    return ctx.redirect(`/settings/password`)
  }

  if (args.newPassword !== args.confirmPassword) {
    ctx.addFlash(`The new passwords don't match.`, `error`)
    return ctx.redirect(`/settings/password`)
  }

  const isCurrent = await users.checkPassword(ctx.state.user.id, args.currentPassword)

  if (isCurrent === false) {
    ctx.addFlash(`That isn't your current password.`, `error`)
    return ctx.redirect(`/settings/password`)
  }

  await users.setPassword(ctx.state.user.id, args.newPassword)

  ctx.addFlash(`Password changed.`, `success`)
  return ctx.redirect(`/settings`)
}
