
import lemonade from '../../services/lemonade.js'

export const GET = async function (ctx) {
  let models = []
  let modelsError = null

  try {
    models = await lemonade.listChatModels()
  } catch (err) {
    console.error(err)
    modelsError = err.message
  }

  ctx.body = ctx.nunjucks(`chat/index`, { models, modelsError })
}
