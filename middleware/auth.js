import users from '../lib/users.js'

// A page marked secure needs a logged-in user: the one whose id the session holds (see
// routes/auth/login.js). A user deleted since they logged in counts as logged out. A page marked
// admin needs an admin too; to anyone else it doesn't exist.
export default async function (ctx, next) {
  if (ctx.meta.secure === true) {
    const userId = ctx.state.session?.data?.userId

    ctx.state.user = null

    if (userId != null) {
      ctx.state.user = users.getUser(userId)
    }

    if (ctx.state.user == null) {
      // Until the first account exists there's nothing to log in to: the setup pages make it
      if (users.hasUsers() === false) {
        return ctx.redirect(`/setup`)
      }

      console.log(`USER NOT LOGGED IN`)
      ctx.writeSession(`redirectAfterLogin`, ctx.path)
      return ctx.redirect(`/auth/login`)
    }

    if (ctx.meta.admin === true && ctx.state.user.isAdmin === false) {
      ctx.throw(404)
    }
  }

  await next()
}
