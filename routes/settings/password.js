import joi from '../../services/joi.js'
import users from '../../services/users.js'

// Form POST from the Change password form on the Settings page. The current password is asked
// for, so a browser left logged in can't change it. Other browsers stay logged in; to log them
// out, a user is removed with scripts/users.js.
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
    return ctx.redirect(`/settings`)
  }

  if (args.newPassword !== args.confirmPassword) {
    ctx.addFlash(`The new passwords don't match.`, `error`)
    return ctx.redirect(`/settings`)
  }

  const isCurrent = await users.checkPassword(ctx.state.user.id, args.currentPassword)

  if (isCurrent === false) {
    ctx.addFlash(`That isn't your current password.`, `error`)
    return ctx.redirect(`/settings`)
  }

  await users.setPassword(ctx.state.user.id, args.newPassword)

  ctx.addFlash(`Password changed.`, `success`)
  return ctx.redirect(`/settings`)
}
