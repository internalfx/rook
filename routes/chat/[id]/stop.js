import runs from '../../../services/runs.js'

// The Stop button. A reply keeps running when the page is left, so stopping it is a request
// of its own.
export const POST = async function (ctx) {
  runs.stopRun(ctx.state.params.id)
  ctx.status = 204
}
