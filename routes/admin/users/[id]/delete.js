import users from '../../../../lib/users.js'

// Form POST from the Remove card on a user's edit page, with their email typed in to confirm.
// Everything that's theirs goes with them, and their browsers are logged out (users.deleteUser).
export const POST = async function (ctx) {
  const user = users.getUser(ctx.state.params.id)

  if (user == null) {
    return ctx.throw(404)
  }

  if (user.id === ctx.state.user.id) {
    ctx.addFlash(`Your own account is removed from another admin's login.`, `error`)
    return ctx.redirect(`/admin/users/${user.id}/edit`)
  }

  const typed = `${ctx.request.body?.confirm ?? ``}`.trim().toLowerCase()

  if (typed !== user.email.toLowerCase()) {
    ctx.addFlash(`Not removed: the email typed wasn't ${user.email}.`, `error`)
    return ctx.redirect(`/admin/users/${user.id}/edit`)
  }

  users.deleteUser(user.id)

  ctx.addFlash(`Removed ${user.name} and everything that was theirs.`, `success`)
  return ctx.redirect(`/admin/users`)
}
