import joi from '../../../lib/joi.js'
import users from '../../../lib/users.js'

// Admin → Users → New user. A slip keeps the name, email and admin choice, never the password.
// The password is only for their first login: once in, they're made to choose their own.

const render = function (ctx, values = { name: ``, email: ``, isAdmin: false }) {
  ctx.body = ctx.nunjucks(`admin/userNew`, { values, passwordMinLength: users.passwordMinLength })
}

export const GET = async function (ctx) {
  render(ctx)
}

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

  const user = await users.createUser({
    name: args.name,
    email: args.email,
    password: args.password,
    isAdmin: kept.isAdmin,
    mustChangePassword: true,
  })

  ctx.addFlash(`Added ${user.name}${user.isAdmin ? ` as an admin` : ``}. They log in with ${user.email} and the password, then choose their own.`, `success`)
  return ctx.redirect(`/admin/users`)
}
