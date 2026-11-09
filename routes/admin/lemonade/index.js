import config from '../../../configure.js'
import serverSettings from '../../../lib/serverSettings.js'

// Admin → Lemonade: the address and key of the server that runs the models, for admins only (see
// middleware/metaRouter.js). Saving takes effect at once (lib/serverSettings.js).

const render = function (ctx, { host, apikey }) {
  ctx.body = ctx.nunjucks(`admin/lemonade`, { lemonadeHost: host, lemonadeKey: apikey })
}

export const GET = async function (ctx) {
  render(ctx, config.lemonade)
}

export const POST = async function (ctx) {
  const body = ctx.request.body ?? {}
  const { errors } = serverSettings.saveForm(body)

  if (errors.length > 0) {
    for (const error of errors) {
      ctx.addFlash(error, `error`)
    }

    // What was typed stays, so a slip is easy to fix
    return render(ctx, { host: body.lemonadeHost ?? ``, apikey: body.lemonadeKey ?? `` })
  }

  ctx.addFlash(`Saved.`, `success`)
  return ctx.redirect(`/admin/lemonade`)
}
