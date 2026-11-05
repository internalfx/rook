import notifications from '../../../services/notifications.js'

// Form POST from a notification's Delete button
export const POST = async function (ctx) {
  notifications.deleteNotification(ctx.state.user.id, ctx.state.params.id)

  return ctx.redirect(`/notifications`)
}
