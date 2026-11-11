import joi from '../../lib/joi.js'
import settings from '../../lib/settings.js'
import users from '../../lib/users.js'
import { readDestination } from '../../lib/settingsPages.js'

// Settings → Time zone: where the user is, which is what "today", due dates and the times of
// notifications and briefings are worked out in. Until they choose, it's the server's.

// Every zone the runtime knows, for the list
const timeZones = Intl.supportedValuesOf(`timeZone`)

export const GET = async function (ctx) {
  ctx.body = ctx.nunjucks(`settings/timezone`, {
    timeZone: ctx.state.user.timeZone,
    timeZones,
    serverTimeZone: users.serverTimeZone,
  })
}

export const POST = async function (ctx) {
  let args

  try {
    args = await joi.object({
      timeZone: joi.string().trim().required(),
      // Where to go once saved, when saving from the "Save your changes?" dialog
      returnTo: joi.string(),
    }).validateAsync(ctx.request.body)
  } catch (err) {
    ctx.addFlash(err.message, `error`)
    return ctx.redirect(`/settings/timezone`)
  }

  if (timeZones.includes(args.timeZone) === false) {
    ctx.addFlash(`"${args.timeZone}" isn't a time zone.`, `error`)
    return ctx.redirect(`/settings/timezone`)
  }

  settings.set(ctx.state.user.id, `timeZone`, args.timeZone)

  ctx.addFlash(`Time zone saved.`, `success`)
  return ctx.redirect(readDestination(args.returnTo, `/settings/timezone`))
}
