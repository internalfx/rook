import config from '../../configure.js'
import serverSettings from '../../lib/serverSettings.js'

// Admin → Models: which of the Lemonade server's models each job uses, chosen with everything the
// server has listed underneath. Admins only (see middleware/metaRouter.js).

// Renders the form with `current` as its values: what's saved, or what was just posted when that
// had a problem
const render = async function (ctx, current) {
  const [{ groups, error }, inventory] = await Promise.all([
    serverSettings.listModelGroups(),
    serverSettings.listServerModels(),
  ])

  ctx.body = ctx.nunjucks(`admin/models`, {
    models: current,
    groups,
    groupsError: error,
    serverModels: inventory.models,
    missingModels: inventory.missing,
    serverError: inventory.error,
  })
}

export const GET = async function (ctx) {
  await render(ctx, config.models)
}

export const POST = async function (ctx) {
  const body = ctx.request.body ?? {}
  const { errors } = serverSettings.saveForm(body)

  if (errors.length > 0) {
    for (const error of errors) {
      ctx.addFlash(error, `error`)
    }

    return render(ctx, {
      chat: body.chatModel || null,
      image: body.imageModel || null,
      imageSize: body.imageSize,
      embedding: body.embeddingModel || null,
      pageReader: body.pageReaderModel || null,
    })
  }

  ctx.addFlash(`Saved.`, `success`)
  return ctx.redirect(`/admin/models`)
}
