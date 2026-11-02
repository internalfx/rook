import joi from '../../services/joi.js'
import notifications from '../../services/notifications.js'

// From the Settings page's "Send a test" button, as JSON { url, token }: pushes a test notification
// to what's typed there, saved or not, and answers { ok, error }
export const POST = async function (ctx) {
  let args

  try {
    args = await joi.object({
      url: joi.string().trim().required(),
      token: joi.string().trim(),
    }).validateAsync(ctx.request.body)
  } catch (err) {
    ctx.body = { ok: false, error: `Enter the ntfy topic URL first.` }
    return
  }

  const result = await notifications.sendTest({ url: args.url, token: args.token })

  ctx.body = result
}
