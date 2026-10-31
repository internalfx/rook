
import _ from 'lodash'

export default async function (ctx, next) {
  const count = _.uniqueId()
  console.time(`[${count}] ${ctx.method} ${ctx.request.url}`)
  await next()
  console.timeEnd(`[${count}] ${ctx.method} ${ctx.request.url}`)
}
