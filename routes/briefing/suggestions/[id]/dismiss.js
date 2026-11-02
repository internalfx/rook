import briefings from '../../../../services/briefings.js'

// Form POST from a suggestion's Dismiss button
export const POST = async function (ctx) {
  briefings.dismissSuggestion(ctx.state.params.id)

  return ctx.redirect(`/briefing`)
}
