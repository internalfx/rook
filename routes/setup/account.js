import joi from '../../lib/joi.js'
import users from '../../lib/users.js'
import settings from '../../lib/settings.js'

// Setup, step 4: the first account, which is the admin's. Making it logs the browser in and ends
// setup: from then on, these pages send everyone to the login page.

const timeZones = Intl.supportedValuesOf(`timeZone`)

export const GET = async function (ctx) {
  if (users.hasUsers()) {
    return ctx.redirect(`/auth/login`)
  }

  ctx.body = ctx.nunjucks(`setup/account`, { passwordMinLength: users.passwordMinLength })
}

export const POST = async function (ctx) {
  if (users.hasUsers()) {
    return ctx.redirect(`/auth/login`)
  }

  const body = ctx.request.body ?? {}
  let args

  try {
    args = await joi.object({
      name: joi.string().trim().max(200).required(),
      email: joi.string().trim().email({ tlds: false }).required(),
      password: joi.string().min(users.passwordMinLength).required(),
      confirm: joi.string().required(),
      timeZone: joi.string().trim().allow(``),
    }).validateAsync(body, { stripUnknown: true })
  } catch (e) {
    ctx.addFlash(e.message, `error`)
    ctx.body = ctx.nunjucks(`setup/account`, { name: body.name, email: body.email, passwordMinLength: users.passwordMinLength })
    return
  }

  if (args.password !== args.confirm) {
    ctx.addFlash(`The passwords don't match.`, `error`)
    ctx.body = ctx.nunjucks(`setup/account`, { name: args.name, email: args.email, passwordMinLength: users.passwordMinLength })
    return
  }

  const user = await users.createUser({ name: args.name, email: args.email, password: args.password, isAdmin: true })

  if (args.timeZone != null && timeZones.includes(args.timeZone)) {
    settings.set(user.id, `timeZone`, args.timeZone)
  }

  ctx.regenerateSession()
  ctx.writeSession(`userId`, user.id)

  return ctx.redirect(`/setup/done`)
}
