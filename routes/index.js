
import lemonade from '../services/lemonade.js'

// 262144 => "256K"
const formatContextLength = function (tokens) {
  if (tokens == null) {
    return null
  }

  const thousands = Math.round(tokens / 1024)

  return `${thousands}K`
}

export const GET = async function (ctx) {
  let models = []
  let modelsError = null

  // The dashboard should still load when the Lemonade server is unreachable
  try {
    const modelList = await lemonade.listModels()

    models = modelList.map(function (model) {
      return {
        id: model.id,
        labels: model.labels ?? [],
        recipe: model.recipe,
        sizeGB: model.size ?? null,
        contextLength: formatContextLength(model.context_length),
        downloaded: model.downloaded === true,
      }
    })
  } catch (err) {
    console.error(err)
    modelsError = err.message
  }

  ctx.body = ctx.nunjucks(`index`, { models, modelsError })
}
