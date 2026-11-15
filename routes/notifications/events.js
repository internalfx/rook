import notificationEvents from '../../lib/notificationEvents.js'

// Kept open by every rook page (templates/layouts/default.njk): each notification sent to the
// user arrives here as a "notification" event, for the page to pop up on the desktop
export const GET = async function (ctx) {
  notificationEvents.watch(ctx, ctx.state.user.id)
}
