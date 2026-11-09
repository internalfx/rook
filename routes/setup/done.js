// The end of setup: logged in as the new admin (the only setup page that needs a login, see
// middleware/metaRouter.js), with what to do next
export const GET = async function (ctx) {
  ctx.body = ctx.nunjucks(`setup/done`)
}
