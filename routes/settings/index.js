// Settings is a group of pages in the sidebar, each user's own: their time zone (timezone.js),
// Slack (slack.js), where notifications are pushed (notifications.js), who may send them task
// requests (people.js) and their password (password.js). What applies to everyone (the models,
// the tools and the briefing schedule) is on the Admin pages. /settings itself goes to the first.
export const GET = async function (ctx) {
  return ctx.redirect(`/settings/timezone`)
}
