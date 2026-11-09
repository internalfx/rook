import serverSettings from '../../../lib/serverSettings.js'

// The Check connection button on Admin → Lemonade: tries the address and key typed in the form,
// saved or not. JSON in ({ host, apikey }) and out ({ ok, summary } or { ok: false, error }).
export const POST = async function (ctx) {
  const { host, apikey } = ctx.request.body ?? {}

  ctx.body = await serverSettings.checkServer({ host, apikey })
}
