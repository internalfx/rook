import joi from '../../lib/joi.js'
import settings from '../../lib/settings.js'
import notifications from '../../lib/notifications.js'
import { readDestination } from '../../lib/settingsPages.js'

// Settings → Notifications: the ntfy topic the user's notifications are pushed to, so they reach
// their phone. Without one they're only on the Notifications page. "Send a test" there posts to
// routes/notifications/test.js.

export const GET = async function (ctx) {
  const { url: ntfyUrl, token: ntfyToken } = notifications.getNtfySettings(ctx.state.user.id)

  ctx.body = ctx.nunjucks(`settings/notifications`, { ntfyUrl, ntfyToken })
}

export const POST = async function (ctx) {
  const user = ctx.state.user

  let args

  try {
    args = await joi.object({
      // An empty topic URL turns phone notifications off
      ntfyUrl: joi.string().trim(),
      ntfyToken: joi.string().trim(),
      // Where to go once saved, when saving from the "Save your changes?" dialog
      returnTo: joi.string(),
    }).validateAsync(ctx.request.body)
  } catch (err) {
    ctx.addFlash(err.message, `error`)
    return ctx.redirect(`/settings/notifications`)
  }

  if (args.ntfyUrl != null && notifications.parseTopicUrl(args.ntfyUrl) == null) {
    ctx.addFlash(`"${args.ntfyUrl}" isn't an ntfy topic URL. It should look like https://ntfy.sh/your-topic.`, `error`)
    return ctx.redirect(`/settings/notifications`)
  }

  if (args.ntfyUrl != null) {
    settings.set(user.id, `ntfyUrl`, args.ntfyUrl)
  } else {
    settings.unset(user.id, `ntfyUrl`)
  }

  if (args.ntfyToken != null) {
    settings.set(user.id, `ntfyToken`, args.ntfyToken)
  } else {
    settings.unset(user.id, `ntfyToken`)
  }

  ctx.addFlash(`Notifications saved.`, `success`)
  return ctx.redirect(readDestination(args.returnTo, `/settings/notifications`))
}
