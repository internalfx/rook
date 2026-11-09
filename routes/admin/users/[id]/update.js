import joi from '../../../../lib/joi.js'
import users from '../../../../lib/users.js'

// Form POST from a user's Edit row on Admin → Users: their name and email
export const POST = async function (ctx) {
  const user = users.getUser(ctx.state.params.id)

  if (user == null) {
    return ctx.throw(404)
  }

  let args

  try {
    args = await joi.object({
      name: joi.string().trim().max(200).required(),
      email: joi.string().trim().email({ tlds: false }).required(),
    }).validateAsync(ctx.request.body ?? {}, { stripUnknown: true })
  } catch (e) {
    ctx.addFlash(e.message, `error`)
    return ctx.redirect(`/admin/users`)
  }

  const other = users.findLogin(args.email)

  if (other != null && other.id !== user.id) {
    ctx.addFlash(`There's already a user with the email ${args.email}.`, `error`)
    return ctx.redirect(`/admin/users`)
  }

  users.updateUser(user.id, args)

  ctx.addFlash(`Saved.`, `success`)
  return ctx.redirect(`/admin/users`)
}
