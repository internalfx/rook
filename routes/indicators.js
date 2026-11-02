import indicators from '../lib/indicators.js'

// Polled by the layout, so the nav dots, the tasks badge and the bell update on a page that
// stays open (see templates/layouts/default.njk)
export const GET = async function (ctx) {
  ctx.body = indicators.readIndicators()
}
