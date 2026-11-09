import users from '../../lib/users.js'
import serverSettings from '../../lib/serverSettings.js'

// The Check connection button on the setup page for the Lemonade server: JSON in and out, as
// Admin → Lemonade has (routes/admin/lemonade/check.js), but only while setup is still open
export const POST = async function (ctx) {
  if (users.hasUsers()) {
    ctx.status = 403
    ctx.body = { ok: false, error: `Setup is finished; log in and use Admin → Lemonade.` }
    return
  }

  const { host, apikey } = ctx.request.body ?? {}

  ctx.body = await serverSettings.checkServer({ host, apikey })
}
