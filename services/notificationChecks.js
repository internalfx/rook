import lemonade from '../lib/lemonade.js'
import config from '../configure.js'
import chats from '../lib/chats.js'
import notifications from '../lib/notifications.js'
import users from '../lib/users.js'
import tools from '../ai-tools/index.js'
import { parseArguments } from '../ai-tools/arguments.js'
import { readModelReply } from '../lib/modelStream.js'
import { maxCallsPerTool, describeCallLimit } from '../ai-tools/limits.js'
import prompts from '../lib/prompts.js'

// Sends the scheduled notifications that are due (see lib/notifications.js). Just before
// each goes out, the chat model checks it's still right: it's told only the notification, why
// it was scheduled and what to check, with tools that can look things up but not change them.
// It sends it (reworded if things have changed), delays it, or skips it. Kept apart from
// lib/notifications.js, which the tools load, because this loads the tools.

// One more than this late (the server was down when it was due) is missed, not checked
const maxLateness = 1000 * 60 * 60

// How long before its time a notification is checked, so it's ready to go when it's due
const checkLead = 1000 * 60

// A check that takes longer is stopped, and the notification skipped
const checkTimeLimit = 1000 * 60 * 5

// How many replies the model gets in one check; in the last, it's told to decide
const maxCheckRounds = 6

// How many times a check can put a notification off, and for how long each time
const maxDelays = 2
const minDelayMinutes = 5
const maxDelayMinutes = 240

// What a check can use to look things up, as config.js allows. None of them change anything: a
// check runs with no one watching, and keeps no record of what it did.
const lookupToolNames = [
  `find_tasks`, `search_memories`, `read_slack`, `search_slack`,
  `get_current_time`, `convert_time`, `calculate`, `days_between`, `add_to_date`, `find_weekday`,
]

// The chat a notification was scheduled in: its last few messages, so the check can see if the
// user said it's no longer needed
const chatMessageLimit = 6
const chatMessageCharLimit = 300

// The decisions; the first one the model calls ends the check. The descriptions are in lib/prompts.js.
const sendNotificationTool = {
  type: `function`,
  function: {
    name: `send_notification`,
    description: prompts.tools.send_notification.description,
    parameters: {
      type: `object`,
      properties: {
        title: {
          type: `string`,
          description: prompts.tools.send_notification.parameters.title,
        },
        message: {
          type: `string`,
          description: prompts.tools.send_notification.parameters.message,
        },
      },
    },
  },
}

const delayNotificationTool = {
  type: `function`,
  function: {
    name: `delay_notification`,
    description: prompts.tools.delay_notification.description,
    parameters: {
      type: `object`,
      properties: {
        minutes: {
          type: `integer`,
          description: prompts.tools.delay_notification.parameters.minutes,
        },
        reason: {
          type: `string`,
          description: prompts.tools.delay_notification.parameters.reason,
        },
      },
      required: [`minutes`, `reason`],
    },
  },
}

const skipNotificationTool = {
  type: `function`,
  function: {
    name: `skip_notification`,
    description: prompts.tools.skip_notification.description,
    parameters: {
      type: `object`,
      properties: {
        reason: {
          type: `string`,
          description: prompts.tools.skip_notification.parameters.reason,
        },
      },
      required: [`reason`],
    },
  },
}

const decisionToolNames = new Set([`send_notification`, `delay_notification`, `skip_notification`])

const readText = function (value, limit) {
  return typeof value === `string` ? value.trim().slice(0, limit) : ``
}

const shorten = function (text) {
  const trimmed = text.trim()

  if (trimmed.length <= chatMessageCharLimit) {
    return trimmed
  }

  return `${trimmed.slice(0, chatMessageCharLimit)}…`
}

// One system message, since some models' chat templates only accept one, as briefings do
const buildSystemMessage = function (user) {
  const memoriesMessage = tools.buildMemoriesMessage(user.id)

  let content = prompts.notificationCheck.instructions

  if (memoriesMessage != null) {
    content = `${content}\n\n${memoriesMessage.content}`
  }

  return { role: `system`, content }
}

// The end of the chat it was scheduled in, or null when it wasn't (or the chat's gone)
const describeSourceChat = function (scheduled) {
  if (scheduled.chatId == null) {
    return null
  }

  const textMessages = chats.getMessages(scheduled.chatId).filter(function (message) {
    return (message.role === `user` || message.role === `assistant`) && message.content.trim() !== ``
  })

  if (textMessages.length === 0) {
    return null
  }

  const lines = textMessages.slice(-chatMessageLimit).map(function (message) {
    return `${message.role === `user` ? `User` : `You`}: ${shorten(message.content)}`
  })

  return `The end of that chat, "${scheduled.chatTitle ?? `Untitled chat`}" (up to ${chatMessageLimit} messages):\n${lines.join(`\n`)}`
}

// What the model is told about the notification, as the user's message, its times in the
// user's zone
const buildContext = function (scheduled, user) {
  const zone = user.timeZone
  const lines = [
    `Title: ${scheduled.title}`,
    `Message: ${scheduled.message}`,
  ]

  if (scheduled.priority === `high`) {
    lines.push(`Priority: high`)
  }

  const where = scheduled.source === `briefing` ? `by a briefing` : `in the chat "${scheduled.chatTitle ?? `Untitled chat`}"`
  lines.push(`Scheduled ${tools.describeSendTime(scheduled.createdAt, zone)}, ${where}.`)

  const lateMinutes = Math.floor((Date.now() - Date.parse(scheduled.sendAt)) / 60000)
  lines.push(`Due ${tools.describeSendTime(scheduled.sendAt, zone)}${lateMinutes >= 1 ? `, ${lateMinutes} minutes ago: the server was down then` : ``}.`)

  if (scheduled.checkNote !== ``) {
    lines.push(`What to check first: ${scheduled.checkNote}`)
  }

  if (scheduled.delays > 0) {
    lines.push(`Delayed ${scheduled.delays === 1 ? `once` : `${scheduled.delays} times`} already, most recently because: ${scheduled.note}`)
  }

  if (scheduled.delays >= maxDelays) {
    lines.push(prompts.notificationCheck.noMoreDelays)
  }

  const sections = [
    tools.describeCurrentTime(user),
    `## The notification\n\n${lines.join(`\n`)}`,
  ]

  const chatText = describeSourceChat(scheduled)

  if (chatText != null) {
    sections.push(`## Where it was scheduled\n\n${chatText}`)
  }

  return sections.join(`\n\n`)
}

// A decision the model called => { decision, … }, or { problem } to tell the model instead
const readDecision = function (name, argumentsText, scheduled) {
  const args = parseArguments(argumentsText) ?? {}

  if (name === `send_notification`) {
    return {
      decision: `send`,
      title: readText(args.title, 120) || scheduled.title,
      message: readText(args.message, 2000) || scheduled.message,
    }
  }

  if (name === `delay_notification`) {
    if (scheduled.delays >= maxDelays) {
      return { problem: `Not delayed: it has been delayed ${maxDelays} times already. Send it or skip it.` }
    }

    const minutes = Number(args.minutes)

    if (Number.isInteger(minutes) === false || minutes < minDelayMinutes || minutes > maxDelayMinutes) {
      return { problem: `Not delayed: minutes must be a whole number from ${minDelayMinutes} to ${maxDelayMinutes}.` }
    }

    return { decision: `delay`, minutes, reason: readText(args.reason, 300) || `No reason given.` }
  }

  return { decision: `skip`, reason: readText(args.reason, 300) || `No reason given.` }
}

// Has the model decide what to do with `scheduled`, which is `user`'s: { decision: `send`, title,
// message }, { decision: `delay`, minutes, reason } or { decision: `skip`, reason }, or null when
// it didn't decide. Throws when the model can't be asked, or `signal` stops it.
const checkNotification = async function (scheduled, user, signal) {
  const model = config.models.chat

  if (model == null) {
    throw new Error(`no chat model is named in config.js`)
  }

  const chatTools = tools.getChatTools(user)
  const lookupTools = {}

  for (const name of lookupToolNames) {
    if (chatTools[name] != null) {
      lookupTools[name] = chatTools[name]
    }
  }

  const decisionTools = scheduled.delays < maxDelays
    ? [sendNotificationTool, delayNotificationTool, skipNotificationTool]
    : [sendNotificationTool, skipNotificationTool]
  const definitions = [...tools.getToolDefinitions(lookupTools), ...decisionTools]

  const messages = [buildSystemMessage(user), { role: `user`, content: buildContext(scheduled, user) }]

  // How many times the model has called each lookup tool in this check, by name
  const callCounts = {}

  // No one watches a check as it runs
  const ignoreEvent = function () {}

  // Once it's told to decide, it's only offered the decisions. That's when it answers without
  // calling a tool, and before its last turn.
  let mustDecide = false

  const tellToDecide = function () {
    messages.push({ role: `user`, content: prompts.notificationCheck.decideNow })
    mustDecide = true
  }

  for (let round = 1; round <= maxCheckRounds; round += 1) {
    if (round === maxCheckRounds && mustDecide === false) {
      tellToDecide()
    }

    const roundTools = mustDecide ? decisionTools : definitions
    const upstream = await lemonade.streamChat({ model, messages, tools: roundTools, signal })
    const reply = await readModelReply({ upstream, sendEvent: ignoreEvent, signal })

    if (reply.finished === false) {
      signal.throwIfAborted()
      throw new Error(reply.error ?? `the reply was cut short`)
    }

    if (reply.toolCalls.length === 0) {
      if (mustDecide) {
        return null
      }

      messages.push({ role: `assistant`, content: reply.content })
      tellToDecide()
      continue
    }

    messages.push({ role: `assistant`, content: reply.content, tool_calls: reply.toolCalls })

    for (const call of reply.toolCalls) {
      const name = call.function.name
      let content = null

      if (decisionToolNames.has(name)) {
        const decision = readDecision(name, call.function.arguments, scheduled)

        if (decision.problem == null) {
          return decision
        }

        content = decision.problem
      } else {
        const callCount = (callCounts[name] ?? 0) + 1
        callCounts[name] = callCount

        if (callCount > maxCallsPerTool) {
          content = describeCallLimit(name, `check`)
        } else {
          // A name the model made up, or one left out, is answered as turned off
          const result = await tools.runTool({ name, argumentsText: call.function.arguments, chatTools: lookupTools, user, chatId: null, signal })
          content = result.content
        }
      }

      messages.push({ role: `tool`, tool_call_id: call.id, content })
    }
  }

  return null
}

// Checks one due notification, then sends, delays or skips it. It never throws.
const handleDue = async function (scheduled) {
  const lateBy = Date.now() - Date.parse(scheduled.sendAt)

  if (lateBy > maxLateness) {
    notifications.markSkipped(scheduled.id, `missed`, `The server was down when it was due.`)
    console.log(`Scheduled notification "${scheduled.title}" missed: it was due ${scheduled.sendAt}`)
    return
  }

  // Whose it is; one whose user is gone goes with them (ON DELETE CASCADE), so this is only null
  // for a row with no user, which is nobody's
  const user = users.getUser(scheduled.userId)

  if (user == null) {
    notifications.markSkipped(scheduled.id, `skipped`, `It belongs to no user.`)
    return
  }

  const timeLimit = AbortSignal.timeout(checkTimeLimit)
  let result = null

  try {
    result = await checkNotification(scheduled, user, timeLimit)
  } catch (err) {
    const problem = timeLimit.aborted ? `it took longer than ${checkTimeLimit / 60000} minutes` : err.message
    console.error(`Checking the scheduled notification "${scheduled.title}" failed`, err)
    notifications.markSkipped(scheduled.id, `skipped`, `The check failed: ${problem}`)
    return
  }

  // It may have been cancelled while it was checked
  const current = notifications.getScheduled(user.id, scheduled.id)

  if (current == null || current.status !== `waiting`) {
    return
  }

  if (result == null) {
    notifications.markSkipped(scheduled.id, `skipped`, `The check didn't decide whether to send it.`)
    console.log(`Scheduled notification "${scheduled.title}" skipped: the check didn't decide`)
    return
  }

  if (result.decision === `send`) {
    await notifications.sendNotification({ userId: user.id, title: result.title, message: result.message, priority: scheduled.priority, briefingId: scheduled.briefingId })
    notifications.deleteScheduled(scheduled.id)
    console.log(`Scheduled notification "${result.title}" sent`)
    return
  }

  if (result.decision === `delay`) {
    notifications.delayScheduled(scheduled.id, new Date(Date.now() + result.minutes * 60000), result.reason)
    console.log(`Scheduled notification "${scheduled.title}" delayed ${result.minutes} minutes: ${result.reason}`)
    return
  }

  notifications.markSkipped(scheduled.id, `skipped`, result.reason)
  console.log(`Scheduled notification "${scheduled.title}" skipped: ${result.reason}`)
}

// Whether sendDue is still going from an earlier minute
let isSending = false

// Called every minute (see services/cron.js): checks and sends, one at a time, every user's
// scheduled notifications due within checkLead, then deletes old skipped and missed ones
export const sendDue = async function () {
  if (isSending) {
    return
  }

  isSending = true

  try {
    const due = notifications.listDue(new Date(Date.now() + checkLead))

    for (const scheduled of due) {
      await handleDue(scheduled)
    }

    notifications.deleteOldSkipped()
  } finally {
    isSending = false
  }
}

export default {
  sendDue,
}
