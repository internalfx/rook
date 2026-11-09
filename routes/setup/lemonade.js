import config from '../../configure.js'
import users from '../../lib/users.js'
import serverSettings from '../../lib/serverSettings.js'

// Setup, step 2: the Lemonade server's address and key, saved to the server settings

export const GET = async function (ctx) {
  if (users.hasUsers()) {
    return ctx.redirect(`/auth/login`)
  }

  ctx.body = ctx.nunjucks(`setup/lemonade`, { lemonadeHost: config.lemonade.host, lemonadeKey: config.lemonade.apikey })
}

export const POST = async function (ctx) {
  if (users.hasUsers()) {
    return ctx.redirect(`/auth/login`)
  }

  const body = ctx.request.body ?? {}
  const { values, errors } = serverSettings.validate(serverSettings.readForm(body))

  if (errors.length === 0 && values[`lemonade.host`] === ``) {
    errors.push(`Give the server's address.`)
  }

  if (errors.length > 0) {
    for (const error of errors) {
      ctx.addFlash(error, `error`)
    }

    ctx.body = ctx.nunjucks(`setup/lemonade`, { lemonadeHost: body.lemonadeHost ?? ``, lemonadeKey: body.lemonadeKey ?? `` })
    return
  }

  serverSettings.save(values)

  return ctx.redirect(`/setup/models`)
}
