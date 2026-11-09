import config from '../../configure.js'
import users from '../../lib/users.js'
import serverSettings from '../../lib/serverSettings.js'

// Setup, step 3: the models, from what the saved Lemonade server lists. The chat model is needed
// when the server answers; when it doesn't, the step can be skipped and finished in Admin →
// Settings.

const render = async function (ctx, models) {
  const { groups, error } = await serverSettings.listModelGroups()

  ctx.body = ctx.nunjucks(`setup/models`, { lemonadeHost: config.lemonade.host, models, groups, groupsError: error })
}

export const GET = async function (ctx) {
  if (users.hasUsers()) {
    return ctx.redirect(`/auth/login`)
  }

  await render(ctx, config.models)
}

export const POST = async function (ctx) {
  if (users.hasUsers()) {
    return ctx.redirect(`/auth/login`)
  }

  const body = ctx.request.body ?? {}
  const { values, errors } = serverSettings.validate(serverSettings.readForm(body))
  const { groups } = await serverSettings.listModelGroups()

  if (errors.length === 0 && groups != null && values[`models.chat`] == null) {
    errors.push(`Choose a chat model.`)
  }

  if (errors.length > 0) {
    for (const error of errors) {
      ctx.addFlash(error, `error`)
    }

    const posted = {
      chat: body.chatModel || null,
      image: body.imageModel || null,
      imageSize: body.imageSize,
      embedding: body.embeddingModel || null,
      pageReader: body.pageReaderModel || null,
    }

    return render(ctx, posted)
  }

  serverSettings.save(values)

  return ctx.redirect(`/setup/account`)
}
