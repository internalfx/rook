import config from '../configure.js'

// Rook has a single owner, defined in config.js; there is no users table
export default async function (ctx, next) {
  if (ctx.meta.secure === true) {
    const isLoggedIn = ctx.state.session?.data?.loggedIn === true

    ctx.state.user = null

    if (isLoggedIn) {
      ctx.state.user = {
        name: config.owner.name,
        email: config.owner.email,
      }
    }

    if (ctx.state.user == null) {
      console.log(`USER NOT LOGGED IN`)
      ctx.writeSession(`redirectAfterLogin`, ctx.path)
      return ctx.redirect(`/auth/login`)
    }

    ctx.state.username = ctx.state.user.email
  }

  await next()
}
