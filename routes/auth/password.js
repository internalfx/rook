import joi from '../../lib/joi.js'
import users from '../../lib/users.js'

// Where a user whose password an admin picked (Admin → Users: Add user, or Password) chooses
// their own. middleware/auth.js sends them here from every page until they have. The password
// they were given isn't asked for again: they typed it to log in, and a reset logs out every
// browser that was logged in before it.

export const GET = async function (ctx) {
  if (ctx.state.user.mustChangePassword === false) {
    return ctx.redirect(`/settings/password`)
  }

  ctx.body = ctx.nunjucks(`auth/password`, { passwordMinLength: users.passwordMinLength })
}

export const POST = async function (ctx) {
  if (ctx.state.user.mustChangePassword === false) {
    return ctx.redirect(`/settings/password`)
  }

  let args

  try {
    args = await joi.object({
      newPassword: joi.string().min(users.passwordMinLength).required(),
      confirmPassword: joi.string().required(),
    }).validateAsync(ctx.request.body ?? {}, { stripUnknown: true })
  } catch (err) {
    ctx.addFlash(err.message, `error`)
    return ctx.redirect(`/auth/password`)
  }

  if (args.newPassword !== args.confirmPassword) {
    ctx.addFlash(`The new passwords don't match.`, `error`)
    return ctx.redirect(`/auth/password`)
  }

  // Keeping the one the admin picked wouldn't be choosing their own
  const isSameAsGiven = await users.checkPassword(ctx.state.user.id, args.newPassword)

  if (isSameAsGiven === true) {
    ctx.addFlash(`Choose a different password from the one you were given.`, `error`)
    return ctx.redirect(`/auth/password`)
  }

  await users.setPassword(ctx.state.user.id, args.newPassword)

  ctx.addFlash(`Password changed.`, `success`)
  return ctx.redirect(`/`)
}
