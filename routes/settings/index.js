
import joi from '../../services/joi.js'
import lemonade from '../../services/lemonade.js'
import settings from '../../services/settings.js'
import tools from '../../ai-tools/index.js'
import briefings from '../../services/briefings.js'
import notifications from '../../services/notifications.js'
import slack from '../../services/slack.js'
import { parseDomains } from '../../ai-tools/sites.js'
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
  let embeddingModels = []
  let modelsError = null

  try {
    const models = await lemonade.listModels()

    const chatModelList = models.filter(function (model) {
      return lemonade.hasLabel(model, `chat`)
    })

    const imageModelList = models.filter(function (model) {
      return lemonade.hasLabel(model, `image`)
    })

    const embeddingModelList = models.filter(function (model) {
      return lemonade.hasLabel(model, `embeddings`)
    })

    chatModels = chatModelList.map(toModelOption)
    imageModels = imageModelList.map(toModelOption)
    embeddingModels = embeddingModelList.map(toModelOption)
  } catch (err) {
    console.error(err)
    modelsError = err.message
  }

  const chatModel = settings.get(`chatModel`)
  const imageModel = settings.get(`imageModel`)
  const imageSize = settings.get(`imageSize`) ?? tools.defaultImageSize
  // The text box shows one site per line
  const webDomainsText = tools.getWebDomains().join(`\n`)
  const isWebPagesOn = tools.isWebPagesOn()
  const isWebSearchOn = tools.isWebSearchOn()
  const embeddingModel = tools.getEmbeddingModel()
  // The switch shows what was chosen, even while there's no embedding model to make it work
  const isMemoriesSwitchOn = settings.get(`memoriesOn`) === true
  const isTasksOn = tools.isTasksOn()
  const isBriefingOn = briefings.isScheduleOn()
  const briefingMinutes = briefings.getBriefingMinutes()
  const { url: ntfyUrl, token: ntfyToken } = notifications.getNtfySettings()

  // The Slack conversations to pick from, as two groups (channels, then group DMs and DMs), each
  // with the picked ones first. While Slack can't be read, the page shows why, with the picks as
  // they are.
  const isSlackConfigured = slack.isConfigured()
  const slackPicks = tools.getSlackChannels()
  let slackGroups = []
  let slackError = null

  if (isSlackConfigured) {
    try {
      const conversations = await slack.listMyConversations()

      const pickedIds = new Set(slackPicks.map(function (conversation) {
        return conversation.id
      }))

      const options = conversations.map(function (conversation) {
        return { ...conversation, picked: pickedIds.has(conversation.id) }
      })

      // The list comes sorted by kind, then label; a stable sort keeps that within each half
      const pickedFirst = function (a, b) {
        return Number(b.picked) - Number(a.picked)
      }

      const channels = options.filter(function (option) {
        return option.kind === `channel` || option.kind === `private`
      })

      const directMessages = options.filter(function (option) {
        return option.kind === `group` || option.kind === `dm`
      })

      slackGroups = [
        { title: `Channels`, conversations: channels.sort(pickedFirst) },
        { title: `Direct messages`, conversations: directMessages.sort(pickedFirst) },
      ]
    } catch (err) {
      console.error(err)
      slackError = err.message
    }
  }

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
    webDomainsText,
    isWebPagesOn,
    isWebSearchOn,
    embeddingModels,
    embeddingModel,
    isEmbeddingModelListed: isListed(embeddingModels, embeddingModel),
    isMemoriesSwitchOn,
    isTasksOn,
    isBriefingOn,
    briefingMinutes,
    ntfyUrl,
    ntfyToken,
    isSlackConfigured,
    slackGroups,
    slackPicks,
    slackError,
  })
}

export const POST = async function (ctx) {
  let args

  try {
    args = await joi.object({
      chatModel: joi.string().trim(),
      imageModel: joi.string().trim(),
      imageSize: joi.string().trim(),
      // One site per line. An empty box arrives as null (see services/joi.js) and turns web
      // pages off.
      webDomains: joi.string(),
      // The switch is a checkbox, which a form leaves out when it's off
      webPagesOn: joi.boolean(),
      webSearchOn: joi.boolean(),
      memoriesOn: joi.boolean(),
      embeddingModel: joi.string().trim(),
      tasksOn: joi.boolean(),
      briefingOn: joi.boolean(),
      // Up to a day
      briefingMinutes: joi.number().integer().min(1).max(1440),
      // An empty topic URL turns phone notifications off
      ntfyUrl: joi.string().trim(),
      ntfyToken: joi.string().trim(),
      // The ids of the Slack conversations picked: a checkbox each, so one arrives as a string.
      // slackShown says the list was on the page, so a Slack outage doesn't clear the picks.
      slackChannels: joi.array().items(joi.string()).single(),
      slackShown: joi.boolean(),
      // Where to go once saved, when saving from the "Save your changes?" dialog
      returnTo: joi.string(),
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

  if (args.embeddingModel != null) {
    const embeddingModel = models.find(function (model) {
      return model.id === args.embeddingModel
    })

    if (embeddingModel == null || lemonade.hasLabel(embeddingModel, `embeddings`) === false) {
      ctx.addFlash(`"${args.embeddingModel}" isn't an embedding model on the Lemonade server.`, `error`)
      return ctx.redirect(`/settings`)
    }
  }

  // Memories are searched with the embedding model, so they can't be on without one
  const hasEmbeddingModel = args.embeddingModel != null || tools.getEmbeddingModel() != null

  if (args.memoriesOn === true && hasEmbeddingModel === false) {
    ctx.addFlash(`Choose an embedding model to turn memories on.`, `error`)
    return ctx.redirect(`/settings`)
  }

  if (args.ntfyUrl != null && notifications.parseTopicUrl(args.ntfyUrl) == null) {
    ctx.addFlash(`"${args.ntfyUrl}" isn't an ntfy topic URL. It should look like https://ntfy.sh/your-topic.`, `error`)
    return ctx.redirect(`/settings`)
  }

  if (args.imageSize != null && tools.imageSizes.includes(args.imageSize) === false) {
    ctx.addFlash(`"${args.imageSize}" isn't one of the image sizes.`, `error`)
    return ctx.redirect(`/settings`)
  }

  const { domains: webDomains, invalid: invalidSites } = parseDomains(args.webDomains ?? ``)

  if (invalidSites.length > 0) {
    ctx.addFlash(`These aren't sites: ${invalidSites.join(`, `)}. Put one site per line, like github.com.`, `error`)
    return ctx.redirect(`/settings`)
  }

  // The picks are saved with their labels, so chats can name them without asking Slack
  let slackPicks = null

  if (args.slackShown === true) {
    try {
      const conversations = await slack.listMyConversations()
      const pickedIds = new Set(args.slackChannels ?? [])

      slackPicks = conversations.filter(function (conversation) {
        return pickedIds.has(conversation.id)
      })
    } catch (err) {
      ctx.addFlash(`Couldn't read Slack to save its conversations: ${err.message}`, `error`)
      return ctx.redirect(`/settings`)
    }
  }

  if (args.chatModel != null) {
    settings.set(`chatModel`, args.chatModel)
  }

  if (args.imageSize != null) {
    settings.set(`imageSize`, args.imageSize)
  }

  if (webDomains.length > 0) {
    settings.set(`webDomains`, webDomains)
  } else {
    settings.unset(`webDomains`)
  }

  if (args.webPagesOn === true) {
    settings.unset(`webPagesOff`)
  } else {
    settings.set(`webPagesOff`, true)
  }

  if (args.webSearchOn === true) {
    settings.set(`webSearchOn`, true)
  } else {
    settings.unset(`webSearchOn`)
  }

  if (args.embeddingModel != null) {
    settings.set(`embeddingModel`, args.embeddingModel)
  }

  if (args.memoriesOn === true) {
    settings.set(`memoriesOn`, true)
  } else {
    settings.unset(`memoriesOn`)
  }

  // On unless switched off, like web pages
  if (args.tasksOn === true) {
    settings.unset(`tasksOff`)
  } else {
    settings.set(`tasksOff`, true)
  }

  if (args.briefingOn === true) {
    settings.set(`briefingOn`, true)
  } else {
    settings.unset(`briefingOn`)
  }

  if (args.briefingMinutes != null) {
    settings.set(`briefingMinutes`, args.briefingMinutes)
  }

  if (args.ntfyUrl != null) {
    settings.set(`ntfyUrl`, args.ntfyUrl)
  } else {
    settings.unset(`ntfyUrl`)
  }

  if (args.ntfyToken != null) {
    settings.set(`ntfyToken`, args.ntfyToken)
  } else {
    settings.unset(`ntfyToken`)
  }

  // Left as they are when the list wasn't on the page
  if (slackPicks != null) {
    if (slackPicks.length > 0) {
      settings.set(`slackChannels`, slackPicks)
    } else {
      settings.unset(`slackChannels`)
    }
  }

  if (turnImagesOff) {
    settings.unset(`imageModel`)
  } else if (args.imageModel != null) {
    settings.set(`imageModel`, args.imageModel)
  }

  ctx.addFlash(`Settings saved.`, `success`)

  // Only a page in rook: browsers read "//example.com" and "/\example.com" as another site
  const returnTo = args.returnTo ?? ``
  const isRookPath = returnTo.startsWith(`/`) && returnTo.startsWith(`//`) === false && returnTo.includes(`\\`) === false

  if (isRookPath) {
    return ctx.redirect(returnTo)
  }

  return ctx.redirect(`/settings`)
}
