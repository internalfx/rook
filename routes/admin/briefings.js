import config from '../../configure.js'
import serverSettings from '../../lib/serverSettings.js'

// Admin → Briefings: whether briefings run on a schedule, and how far apart. Admins only (see
// middleware/metaRouter.js).

const render = function (ctx, briefings) {
  ctx.body = ctx.nunjucks(`admin/briefings`, { briefings })
}

export const GET = async function (ctx) {
  render(ctx, config.briefings)
}

export const POST = async function (ctx) {
  const body = ctx.request.body ?? {}
  const { errors } = serverSettings.saveForm(body, { switches: [`briefingsOn`] })

  if (errors.length > 0) {
    for (const error of errors) {
      ctx.addFlash(error, `error`)
    }

    return render(ctx, { on: body.briefingsOn != null, minutes: body.briefingMinutes })
  }

  ctx.addFlash(`Saved.`, `success`)
  return ctx.redirect(`/admin/briefings`)
}
