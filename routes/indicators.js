import indicators from '../lib/indicators.js'

// Polled by the layout, so the nav dots and the tasks badge update on a page that
// stays open (see templates/layouts/default.njk)
export const GET = async function (ctx) {
  ctx.body = indicators.readIndicators()
}
