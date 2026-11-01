
import config from '../configure.js'

export default async function (ctx, next) {
  try {
    await next()
  } catch (err) {
    console.error(err)
    let status = 500
    if (Number.isInteger(err.status)) {
      status = err.status
    }
    ctx.status = status
    let message = err.message
    if (status >= 500 && config.isProduction) {
      message = `There was an error processing your request.`
    }
    ctx.body = message
  }
}
