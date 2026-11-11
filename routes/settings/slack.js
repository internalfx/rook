import joi from '../../lib/joi.js'
import settings from '../../lib/settings.js'
import tools from '../../ai-tools/index.js'
import slack from '../../lib/slack.js'
import { readDestination } from '../../lib/settingsPages.js'

// Settings → Slack: the user's own Slack token, and which of their conversations the chat model
// and briefings read. Slack is only ever read, as them.

export const GET = async function (ctx) {
  const user = ctx.state.user

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

  ctx.body = ctx.nunjucks(`settings/slack`, {
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
    return ctx.redirect(`/settings/slack`)
  }

  // Check everything before saving anything, so a bad token doesn't leave half the form saved.
  // A new token is tried before it's saved, so a typo doesn't take Slack away.
  const isNewToken = args.slackToken != null && args.slackToken !== settings.get(user.id, `slackToken`)

  if (isNewToken) {
    const check = await slack.checkToken(args.slackToken)

    if (check.ok === false) {
      ctx.addFlash(`That Slack token doesn't work: ${check.error}`, `error`)
      return ctx.redirect(`/settings/slack`)
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
      return ctx.redirect(`/settings/slack`)
    }
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

  ctx.addFlash(`Slack saved.`, `success`)
  return ctx.redirect(readDestination(args.returnTo, `/settings/slack`))
}
