import config from '../../configure.js'
import serverSettings from '../../lib/serverSettings.js'

// Admin → Tools: what the chat model may do for everyone, and which sites it may read. Admins only
// (see middleware/metaRouter.js).

const switches = [`tasks`, `memories`, `webSearch`, `webPages`]

const render = function (ctx, tools) {
  ctx.body = ctx.nunjucks(`admin/tools`, { tools })
}

export const GET = async function (ctx) {
  render(ctx, config.tools)
}

export const POST = async function (ctx) {
  const body = ctx.request.body ?? {}
  const { errors } = serverSettings.saveForm(body, { switches })

  if (errors.length > 0) {
    for (const error of errors) {
      ctx.addFlash(error, `error`)
    }

    // The posted form as the page shows it again, so a mistake doesn't lose what was typed
    return render(ctx, {
      tasks: body.tasks != null,
      memories: body.memories != null,
      webSearch: body.webSearch != null,
      webPages: body.webPages != null,
      webDomains: `${body.webDomains ?? ``}`.split(`\n`).map((line) => line.trim()).filter((line) => line !== ``),
    })
  }

  ctx.addFlash(`Saved.`, `success`)
  return ctx.redirect(`/admin/tools`)
}
