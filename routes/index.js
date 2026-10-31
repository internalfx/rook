
export const GET = async function (ctx) {
  ctx.body = ctx.nunjucks(`index`)
}
