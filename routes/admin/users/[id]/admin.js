import users from '../../../../lib/users.js'

// Form POST from a user's Make admin / Remove admin button on Admin → Users. An admin's own status
// is another admin's to change, so no one takes the last admin away.
export const POST = async function (ctx) {
  const user = users.getUser(ctx.state.params.id)

  if (user == null) {
    return ctx.throw(404)
  }

  if (user.id === ctx.state.user.id) {
    ctx.addFlash(`Another admin has to change your own admin status.`, `error`)
    return ctx.redirect(`/admin/users`)
  }

  const makeAdmin = ctx.request.body?.isAdmin != null

  users.setAdmin(user.id, makeAdmin)

  ctx.addFlash(`${user.name} is ${makeAdmin ? `now an admin` : `no longer an admin`}.`, `success`)
  return ctx.redirect(`/admin/users`)
}
