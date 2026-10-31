
import joi from '../../services/joi.js'
import lemonade from '../../services/lemonade.js'
import settings from '../../services/settings.js'
import tools from '../../services/tools.js'
import { formatContextLength } from '../../lib/format.js'

// Value of the "Off" choice for the image model
const noImageModel = `none`

// The image size choices, in the order of tools.imageSizes
const imageSizeNames = [`Small`, `Medium`, `Large`]

const imageSizeOptions = tools.imageSizes.map(function (size, index) {
  const [width, height] = size.split(`x`)

  return {
    value: size,
    name: imageSizeNames[index],
    dimensions: `${width} × ${height}`,
  }
})

const toModelOption = function (model) {
  return {
    id: model.id,
    labels: model.labels ?? [],
    sizeGB: model.size ?? null,
    contextLength: formatContextLength(model.context_length),
  }
}

const isListed = function (options, id) {
  return options.some(function (option) {
    return option.id === id
  })
}

export const GET = async function (ctx) {
  let chatModels = []
  let imageModels = []
  let modelsError = null

  try {
    const models = await lemonade.listModels()

    const chatModelList = models.filter(function (model) {
      return lemonade.hasLabel(model, `chat`)
    })

    const imageModelList = models.filter(function (model) {
      return lemonade.hasLabel(model, `image`)
    })

    chatModels = chatModelList.map(toModelOption)
    imageModels = imageModelList.map(toModelOption)
  } catch (err) {
    console.error(err)
    modelsError = err.message
  }

  const chatModel = settings.get(`chatModel`)
  const imageModel = settings.get(`imageModel`)
  const imageSize = settings.get(`imageSize`) ?? tools.defaultImageSize

  ctx.body = ctx.nunjucks(`settings/index`, {
    modelsError,
    chatModels,
    imageModels,
    chatModel,
    imageModel,
    imageSize,
    imageSizeOptions,
    noImageModel,
    isChatModelListed: isListed(chatModels, chatModel),
    isImageModelListed: isListed(imageModels, imageModel),
  })
}

export const POST = async function (ctx) {
  let args

  try {
    args = await joi.object({
      chatModel: joi.string().trim(),
      imageModel: joi.string().trim(),
      imageSize: joi.string().trim(),
    }).validateAsync(ctx.request.body)
  } catch (err) {
    ctx.addFlash(err.message, `error`)
    return ctx.redirect(`/settings`)
  }

  const models = await lemonade.listModels()

  // Check everything before saving anything, so a bad choice doesn't leave half the form saved
  if (args.chatModel != null) {
    const chatModel = models.find(function (model) {
      return model.id === args.chatModel
    })

    if (chatModel == null || lemonade.hasLabel(chatModel, `chat`) === false) {
      ctx.addFlash(`"${args.chatModel}" isn't a chat model on the Lemonade server.`, `error`)
      return ctx.redirect(`/settings`)
    }
  }

  const turnImagesOff = args.imageModel === noImageModel

  if (args.imageModel != null && turnImagesOff === false) {
    const imageModel = models.find(function (model) {
      return model.id === args.imageModel
    })

    if (imageModel == null || lemonade.hasLabel(imageModel, `image`) === false) {
      ctx.addFlash(`"${args.imageModel}" isn't an image model on the Lemonade server.`, `error`)
      return ctx.redirect(`/settings`)
    }
  }

  if (args.imageSize != null && tools.imageSizes.includes(args.imageSize) === false) {
    ctx.addFlash(`"${args.imageSize}" isn't one of the image sizes.`, `error`)
    return ctx.redirect(`/settings`)
  }

  if (args.chatModel != null) {
    settings.set(`chatModel`, args.chatModel)
  }

  if (args.imageSize != null) {
    settings.set(`imageSize`, args.imageSize)
  }

  if (turnImagesOff) {
    settings.unset(`imageModel`)
  } else if (args.imageModel != null) {
    settings.set(`imageModel`, args.imageModel)
  }

  ctx.addFlash(`Settings saved.`, `success`)
  return ctx.redirect(`/settings`)
}
