import users from '../../lib/users.js'

// The setup pages, shown to whoever first opens a new install, while no account exists: the
// Lemonade server, the models, then the admin's account (see middleware/auth.js, which sends
// visitors here until then). Once there's an account, they go to the login page instead.
export const GET = async function (ctx) {
  if (users.hasUsers()) {
    return ctx.redirect(`/auth/login`)
  }

  ctx.body = ctx.nunjucks(`setup/index`)
}
