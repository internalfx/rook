
import joi from '../../services/joi.js'
import settings from '../../services/settings.js'
import tools from '../../ai-tools/index.js'
import notifications from '../../services/notifications.js'
import slack from '../../services/slack.js'
import users from '../../services/users.js'

// Settings holds what's each user's own: their time zone, where their notifications are pushed,
// their Slack token and which Slack conversations are read, and their password
// (routes/settings/password.js). What applies to everyone (the models, the tools and the
// briefing schedule) is in config.js.

// Every zone the runtime knows, for the time zone list
const timeZones = Intl.supportedValuesOf(`timeZone`)

export const GET = async function (ctx) {
  const user = ctx.state.user
  const { url: ntfyUrl, token: ntfyToken } = notifications.getNtfySettings(user.id)

  // The Slack conversations to pick from, as two groups (channels, then group DMs and DMs), each
  // with the picked ones first. While Slack can't be read, the page shows why, with the picks as
  // they are.
  const slackToken = settings.get(user.id, `slackToken`)
  const isSlackConfigured = slack.isConfigured(user.id)
  const slackPicks = tools.getSlackChannels(user)
  let slackGroups = []
  let slackError = null

  if (isSlackConfigured) {
    try {
      const conversations = await slack.listMyConversations(user.id)

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
    timeZone: user.timeZone,
    timeZones,
    serverTimeZone: users.serverTimeZone,
    ntfyUrl,
    ntfyToken,
    slackToken,
    isSlackConfigured,
    slackGroups,
    slackPicks,
    slackError,
  })
}

export const POST = async function (ctx) {
  const user = ctx.state.user

  let args

  try {
    args = await joi.object({
      timeZone: joi.string().trim(),
      // An empty topic URL turns phone notifications off
      ntfyUrl: joi.string().trim(),
      ntfyToken: joi.string().trim(),
      // An empty token turns Slack off; the picks are kept for when one is added again
      slackToken: joi.string().trim(),
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

  // Check everything before saving anything, so a bad choice doesn't leave half the form saved
  if (args.timeZone != null && timeZones.includes(args.timeZone) === false) {
    ctx.addFlash(`"${args.timeZone}" isn't a time zone.`, `error`)
    return ctx.redirect(`/settings`)
  }

  if (args.ntfyUrl != null && notifications.parseTopicUrl(args.ntfyUrl) == null) {
    ctx.addFlash(`"${args.ntfyUrl}" isn't an ntfy topic URL. It should look like https://ntfy.sh/your-topic.`, `error`)
    return ctx.redirect(`/settings`)
  }

  // A new token is tried before it's saved, so a typo doesn't take Slack away
  const isNewToken = args.slackToken != null && args.slackToken !== settings.get(user.id, `slackToken`)

  if (isNewToken) {
    const check = await slack.checkToken(args.slackToken)

    if (check.ok === false) {
      ctx.addFlash(`That Slack token doesn't work: ${check.error}`, `error`)
      return ctx.redirect(`/settings`)
    }
  }

  // The picks are saved with their labels, so chats can name them without asking Slack
  let slackPicks = null

  if (args.slackShown === true && isNewToken === false) {
    try {
      const conversations = await slack.listMyConversations(user.id)
      const pickedIds = new Set(args.slackChannels ?? [])

      slackPicks = conversations.filter(function (conversation) {
        return pickedIds.has(conversation.id)
      })
    } catch (err) {
      ctx.addFlash(`Couldn't read Slack to save its conversations: ${err.message}`, `error`)
      return ctx.redirect(`/settings`)
    }
  }

  if (args.timeZone != null) {
    settings.set(user.id, `timeZone`, args.timeZone)
  }

  if (args.ntfyUrl != null) {
    settings.set(user.id, `ntfyUrl`, args.ntfyUrl)
  } else {
    settings.unset(user.id, `ntfyUrl`)
  }

  if (args.ntfyToken != null) {
    settings.set(user.id, `ntfyToken`, args.ntfyToken)
  } else {
    settings.unset(user.id, `ntfyToken`)
  }

  if (args.slackToken != null) {
    settings.set(user.id, `slackToken`, args.slackToken)
  } else {
    settings.unset(user.id, `slackToken`)
  }

  // Left as they are when the list wasn't on the page, or was for another token
  if (slackPicks != null) {
    if (slackPicks.length > 0) {
      settings.set(user.id, `slackChannels`, slackPicks)
    } else {
      settings.unset(user.id, `slackChannels`)
    }
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
