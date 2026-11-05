import cuid from 'cuid'
import db from './db.js'
import lemonade from './lemonade.js'
import config from '../configure.js'
import settings from './settings.js'
import tools from '../ai-tools/index.js'
import memories from './memories.js'
import chats from './chats.js'
import tasks from './tasks.js'
import runs from './runs.js'
import { readModelReply } from './modelStream.js'
import notifications from './notifications.js'
import slack from './slack.js'
import users from './users.js'
import { maxCallsPerTool, maxRounds, describeCallLimit } from '../ai-tools/limits.js'
import prompts from '../prompts.js'

// A briefing runs the chat model in the background for one user, with no one watching: it looks
// over their memories, tasks, recent chats and the Slack conversations they picked in Settings,
// tidies the memories and tasks, and writes them a short overview. Discuss on the Briefing page
// starts a chat with that overview as the model's first message. For something that matters now,
// it can notify the user (services/notifications.js), or schedule a notification for when it will
// matter. Briefings run on a schedule set in config.js, for every user (see runIfDue), or when a
// user asks for one.
//
// Running briefings live in memory, like chat replies (services/runs.js), so restarting the
// server ends them.

// How many notifications one briefing can send
const maxNotifications = 2

// Each user's latest briefing and one before it are kept; older ones are deleted
const keptBriefings = 2

// What the model is shown
const recentMemoryLimit = 30
const openTaskLimit = 50
// The most recently active chats, whatever their age, each with its last messages
const recentChatLimit = 10
// The tasks done in the last week, with their completion notes, so it knows what's been
// finished or dropped
const doneTaskLookBack = 1000 * 60 * 60 * 24 * 7
const doneTaskLimit = 20
const messagesPerChat = 10
const messageCharLimit = 600

// How far back it sees the notifications sent, so it doesn't repeat one from a few briefings ago
const notificationLookBack = 1000 * 60 * 60 * 24 * 14
const historyLimit = 20

// How far back it sees the scheduled notifications that were skipped or missed
const skippedLookBack = 1000 * 60 * 60 * 24

// Each picked Slack conversation gives its newest messages, whatever their age, and the replies to
// its newest threads
const slackMessageLimit = 30
const slackThreadLimit = 3

// Used while config.js names no interval
export const defaultBriefingMinutes = 360

// The only chat tools a briefing has: it doesn't search the web or make images. It sees the
// scheduled notifications in its context, so it doesn't need list_scheduled_notifications.
const briefingToolNames = [
  `save_memory`, `search_memories`, `update_memory`, `delete_memory`,
  `add_task`, `find_tasks`, `update_task`, `complete_task`,
  `calculate`, `days_between`, `add_to_date`, `find_weekday`,
  `read_slack`, `search_slack`,
  `schedule_notification`, `cancel_notification`,
]

const insertBriefing = db.query(`
  INSERT INTO briefings (id, userId, status, startedBy, startedAt)
  VALUES ($id, $userId, 'running', $startedBy, $now)
`)
const finishBriefingRow = db.query(`
  UPDATE briefings SET status = $status, overview = $overview, error = $error, transcript = $transcript, finishedAt = $now
  WHERE id = $id
`)
const failStaleBriefings = db.query(`
  UPDATE briefings SET status = 'failed', error = $error, finishedAt = $now WHERE status = 'running'
`)
const selectFinished = db.query(`
  SELECT * FROM briefings WHERE userId = $userId AND status != 'running'
  ORDER BY startedAt DESC LIMIT $limit OFFSET $offset
`)
const selectBriefing = db.query(`SELECT * FROM briefings WHERE id = $id AND userId = $userId`)
const selectLastStarted = db.query(`
  SELECT startedAt FROM briefings WHERE userId = $userId ORDER BY startedAt DESC LIMIT 1
`)
const deleteOldBriefings = db.query(`
  DELETE FROM briefings WHERE userId = $userId AND id NOT IN (
    SELECT id FROM briefings WHERE userId = $userId ORDER BY startedAt DESC LIMIT $keep
  )
`)

const selectLastFinishedAt = db.query(`
  SELECT MAX(finishedAt) AS finishedAt FROM briefings WHERE userId = $userId AND status != 'running'
`)

// A briefing still marked running was cut off by a restart
failStaleBriefings.run({ error: `The server restarted during the briefing.`, now: new Date().toISOString() })

// The briefings running now, by user id, each as { id, user, abort, run, finished }. `run` is
// what the Briefing page watches (see services/runs.js); `finished` settles once it's saved.
const running = new Map()

// What a cancelled briefing's error says, after "This briefing didn't finish:"
const cancelledError = `You cancelled it.`

// How long a whole briefing may take. Its replies stream, which has no limit once the model has
// started answering, so one that stalled would otherwise keep scheduled briefings waiting.
const briefingTimeLimit = 1000 * 60 * 30
const timeLimitError = `It took longer than ${briefingTimeLimit / 60000} minutes, so it was stopped.`

const notifyUserTool = {
  type: `function`,
  function: {
    name: `notify_user`,
    description: prompts.tools.notify_user.description,
    parameters: {
      type: `object`,
      properties: {
        title: {
          type: `string`,
          description: prompts.tools.notify_user.parameters.title,
        },
        message: {
          type: `string`,
          description: prompts.tools.notify_user.parameters.message,
        },
        priority: {
          type: `string`,
          enum: [`normal`, `high`],
          description: prompts.tools.notify_user.parameters.priority,
        },
      },
      required: [`title`, `message`],
    },
  },
}

// "2026-11-01" from an ISO date
const formatDay = function (iso) {
  return iso.slice(0, 10)
}

// "Nov 1, 2026, 9:58 AM", in the user's time zone
const describeWhen = function (iso, zone) {
  return new Date(iso).toLocaleString(`en-US`, { dateStyle: `medium`, timeStyle: `short`, timeZone: zone })
}

const shorten = function (text, limit = messageCharLimit) {
  const trimmed = text.trim()

  if (trimmed.length <= limit) {
    return trimmed
  }

  return `${trimmed.slice(0, limit)}…`
}

// The user's searchable memories it can tidy, with their ids. Pinned ones are in the system
// message.
const describeMemories = function (user) {
  if (tools.isMemoriesOn() === false) {
    return `Memories are off in config.js, so you have none and can't save any.`
  }

  const recent = memories.listRecent(user.id, recentMemoryLimit)

  if (recent.length === 0) {
    return `You have no searchable memories yet.`
  }

  const lines = recent.map(function (memory) {
    return `- [${memory.id}] ${memory.content} (changed ${formatDay(memory.updatedAt)})`
  })

  return `Your searchable memories, most recently changed first (up to ${recentMemoryLimit}; find others with search_memories):\n${lines.join(`\n`)}`
}

const describeTaskLines = function (taskList, zone) {
  const lines = taskList.map(function (task) {
    return `- ${tasks.describeForModel(task, zone)}`
  })

  return lines.join(`\n`)
}

// The user's open tasks, soonest due first, then those done in the last week, with their ids so
// it can change them
const describeTasks = function (user) {
  if (tools.isTasksOn() === false) {
    return `Tasks are off in config.js, so you can't see or change them.`
  }

  const openTasks = tasks.listOpen(user.id)

  let text = `The to-do list is empty.`

  if (openTasks.length > 0) {
    const listed = openTasks.slice(0, openTaskLimit)

    text = `The tasks still to do, soonest due first (up to ${openTaskLimit}; find others with find_tasks):\n${describeTaskLines(listed, user.timeZone)}`

    if (openTasks.length > listed.length) {
      text = `${text}\n…and ${openTasks.length - listed.length} more.`
    }
  }

  const since = new Date(Date.now() - doneTaskLookBack).toISOString()
  const doneTasks = tasks.listDoneSince(user.id, since, doneTaskLimit)

  if (doneTasks.length > 0) {
    text = `${text}\n\nDone in the last 7 days, most recent first (up to ${doneTaskLimit}):\n${describeTaskLines(doneTasks, user.timeZone)}`
  }

  return text
}

// "(with 2 images)", for a message the user attached images to; briefings aren't shown them
const describeAttachedImages = function (message) {
  const count = message.imageIds?.length ?? 0

  if (count === 0) {
    return ``
  }

  return `(with ${count === 1 ? `an image` : `${count} images`})`
}

// A chat's title and its last few messages; tool calls and their results are left out
const describeChat = function (chat) {
  const savedMessages = chats.getMessages(chat.id)

  const textMessages = savedMessages.filter(function (message) {
    const isConversation = message.role === `user` || message.role === `assistant`
    return isConversation && (message.content.trim() !== `` || message.imageIds != null)
  })

  const lastMessages = textMessages.slice(-messagesPerChat)

  const lines = lastMessages.map(function (message) {
    const speaker = message.role === `user` ? `User` : `You`
    const text = [shorten(message.content), describeAttachedImages(message)].filter((part) => part !== ``)
    return `${speaker}: ${text.join(` `)}`
  })

  return `### ${chat.title ?? `Untitled chat`} (last active ${formatDay(chat.updatedAt)})\n${lines.join(`\n`)}`
}

// Every notification sent the user in the last two weeks, whichever briefing sent it
const describeRecentNotifications = function (user) {
  const since = new Date(Date.now() - notificationLookBack).toISOString()
  const sent = notifications.listSentSince(user.id, since, historyLimit)

  if (sent.length === 0) {
    return `None in the last 14 days.`
  }

  const lines = sent.map(function (notification) {
    return `- ${describeWhen(notification.createdAt, user.timeZone)}: "${notification.title}": ${notification.message}`
  })

  return `Newest first (up to ${historyLimit}):\n${lines.join(`\n`)}`
}

// The user's scheduled notifications waiting to be sent, with their ids so it can cancel them,
// then those skipped or missed lately, so it knows what didn't go out
const describeScheduledNotifications = function (user) {
  const waiting = notifications.listWaiting(user.id)
  const skipped = notifications.listSkippedSince(user.id, new Date(Date.now() - skippedLookBack))

  let text = `None are waiting.`

  if (waiting.length > 0) {
    const lines = waiting.map(function (scheduled) {
      return `- ${tools.describeScheduledNotification(scheduled, user.timeZone)}`
    })

    text = `Soonest first. Just before each is due, it's checked against what's happened since, then sent, delayed or skipped.\n${lines.join(`\n`)}`
  }

  if (skipped.length > 0) {
    const lines = skipped.map(function (scheduled) {
      const outcome = scheduled.status === `missed` ? `Missed` : `Skipped`
      return `- ${outcome} "${scheduled.title}" (due ${tools.describeSendTime(scheduled.sendAt, user.timeZone)}): ${scheduled.note}`
    })

    text = `${text}\n\nNot sent in the last 24 hours, most recent first:\n${lines.join(`\n`)}`
  }

  return text
}

// The user's most recently active chats, whatever their age, so the model always sees what's
// been talked about lately
const describeRecentChats = function (user) {
  const recent = chats.listRecentChats(user.id, recentChatLimit)

  if (recent.length === 0) {
    return `There are no chats yet.`
  }

  const sections = recent.map(describeChat)

  return `The most recently active chats, most recent first (up to ${recentChatLimit}, each with its last ${messagesPerChat} messages). Some may be old; each says when it was last active.\n\n${sections.join(`\n\n`)}`
}

// The newest messages in each Slack conversation the user picked, whatever their age, so the
// model always sees where each conversation stands; one with no messages at all is left out. Null
// while Slack is off for them. A failure to read Slack is said in the section, so the briefing
// goes on without it.
const describeSlack = async function (user, signal) {
  const conversations = tools.getSlackChannels(user)

  if (conversations.length === 0) {
    return null
  }

  const sections = []

  try {
    // Read all at once; the sections keep the order of the picks
    const reads = conversations.map(function (conversation) {
      return slack.readConversation({
        userId: user.id,
        timeZone: user.timeZone,
        channelId: conversation.id,
        oldest: null,
        limit: slackMessageLimit,
        threadLimit: slackThreadLimit,
        signal,
      })
    })

    const results = await Promise.all(reads)

    for (const [index, conversation] of conversations.entries()) {
      const result = results[index]

      if (result.messageCount > 0) {
        sections.push(`### ${conversation.label}\n${result.text}`)
      }
    }
  } catch (err) {
    if (signal.aborted === true) {
      throw err
    }

    console.error(`Reading Slack for a briefing failed`, err)
    return `Couldn't read Slack: ${err.message}`
  }

  const labels = conversations.map(function (conversation) {
    return conversation.label
  })

  if (sections.length === 0) {
    return `There are no messages in the user's Slack conversations at work that you follow (${labels.join(`, `)}).`
  }

  return `The newest messages in the user's Slack conversations at work that you follow, oldest first (up to ${slackMessageLimit} each, with replies to the newest ${slackThreadLimit} threads). Some may be old; each has its date and time.\n\n${sections.join(`\n\n`)}`
}

// One system message, since some models' chat templates only accept one, at the start
const buildSystemMessage = function (user) {
  const memoriesMessage = tools.buildMemoriesMessage(user.id)

  let content = prompts.briefing.instructions

  if (memoriesMessage != null) {
    content = `${content}\n\n${memoriesMessage.content}`
  }

  return { role: `system`, content }
}

// What rook tells the model about the state of the user's things, as the user's message. Pass
// `signal` to cancel reading Slack.
const buildContext = async function (user, signal) {
  const sections = [
    tools.describeCurrentTime(user),
    `## Memories\n\n${describeMemories(user)}`,
    `## Tasks\n\n${describeTasks(user)}`,
    `## Notifications you've sent recently\n\n${describeRecentNotifications(user)}`,
    `## Notifications waiting to be sent\n\n${describeScheduledNotifications(user)}`,
    `## Recent chats\n\n${describeRecentChats(user)}`,
  ]

  const slackText = await describeSlack(user, signal)

  if (slackText != null) {
    sections.push(`## Slack\n\n${slackText}`)
  }

  return sections.join(`\n\n`)
}

const notifyUser = async function ({ argumentsText, user, briefingId, state }) {
  if (state.notificationCount >= maxNotifications) {
    return `Not sent: a briefing can send at most ${maxNotifications} notifications.`
  }

  let args = null

  try {
    args = JSON.parse(argumentsText)
  } catch (err) {}

  args = args ?? {}

  const title = typeof args.title === `string` ? args.title.trim().slice(0, 120) : ``
  const message = typeof args.message === `string` ? args.message.trim() : ``
  const priority = args.priority === `high` ? `high` : `normal`

  if (title === `` || message === ``) {
    return `Not sent: a notification needs a title and a message.`
  }

  const notification = await notifications.sendNotification({ userId: user.id, title, message, priority, briefingId })
  state.notificationCount += 1

  if (notification.pushStatus === `sent`) {
    return `Sent to the user's phone.`
  }

  if (notification.pushStatus === `failed`) {
    return `Saved in rook, but pushing it to their phone failed: ${notification.pushError}`
  }

  return `Saved in rook; phone notifications aren't set up.`
}

// Runs one tool call and returns what the model is told about it
const runBriefingTool = async function ({ call, user, briefingId, briefingTools, callCounts, state, isLastRound, signal }) {
  const name = call.function.name
  const argumentsText = call.function.arguments
  const callCount = (callCounts[name] ?? 0) + 1
  callCounts[name] = callCount

  // The calls still need answers, but there's no next round to use them in
  if (isLastRound) {
    return `Not run: the limit of replies for one briefing was reached.`
  }

  if (callCount > maxCallsPerTool) {
    return describeCallLimit(name, `briefing`)
  }

  if (name === `notify_user`) {
    return notifyUser({ argumentsText, user, briefingId, state })
  }

  // A memory tool, or a name the model made up, which runTool answers as turned off
  const result = await tools.runTool({ name, argumentsText, chatTools: briefingTools, user, chatId: null, briefingId, signal })

  return result.content
}

// Runs the model until it replies without calling a tool, and returns that reply: the overview.
// Its replies stream to whoever is watching (the Briefing page, see routes/briefing/stream.js)
// as rook's own events, the same as a chat's (see runConversation in routes/chat/send.js). Each
// reply and tool call is added to `state.transcript` as it finishes, in the chat page's own form,
// so a briefing that fails part way keeps what it did.
const runBriefing = async function ({ briefingId, user, run, state, signal }) {
  const model = config.models.chat

  if (model == null) {
    throw new Error(`Name a chat model in config.js first.`)
  }

  const chatTools = tools.getChatTools(user)
  const briefingTools = {}

  for (const name of briefingToolNames) {
    if (chatTools[name] != null) {
      briefingTools[name] = chatTools[name]
    }
  }

  const definitions = [...tools.getToolDefinitions(briefingTools), notifyUserTool]

  const context = await buildContext(user, signal)
  const messages = [buildSystemMessage(user), { role: `user`, content: context }]

  // How many times the model has called each tool in this briefing, by name
  const callCounts = {}

  const sendEvent = function (event) {
    runs.emit(run, event)
  }

  // A reply that said or thought nothing (it only called tools) isn't kept
  const addReply = function (reasoning, content) {
    if (reasoning !== `` || content !== ``) {
      state.transcript.push({ role: `assistant`, reasoning, content })
    }
  }

  for (let round = 1; round <= maxRounds; round += 1) {
    const upstream = await lemonade.streamChat({ model, messages, tools: definitions, signal })

    sendEvent({ type: `assistant` })

    const reply = await readModelReply({ upstream, sendEvent, signal })

    // Cut short: by Cancel or the time limit, or by the stream failing
    if (reply.finished === false) {
      addReply(reply.reasoning, reply.content)
      signal.throwIfAborted()
      throw new Error(reply.error ?? `The reply was cut short.`)
    }

    const toolCalls = reply.toolCalls

    // The overview's text is saved as the overview, so only its thinking is kept here
    if (toolCalls.length === 0) {
      addReply(reply.reasoning, ``)
      return reply.content.trim()
    }

    addReply(reply.reasoning, reply.content)
    messages.push({ role: `assistant`, content: reply.content, tool_calls: toolCalls })

    const isLastRound = round === maxRounds

    for (const call of toolCalls) {
      // A cancelled briefing doesn't go on to the rest of the round's calls
      signal.throwIfAborted()

      const name = call.function.name
      const details = tools.readCallDetails(call.function.arguments)

      sendEvent({ type: `toolCall`, toolCallId: call.id, name, ...details })

      const result = await runBriefingTool({ call, user, briefingId, briefingTools, callCounts, state, isLastRound, signal })

      sendEvent({ type: `toolResult`, toolCallId: call.id, content: result, imageId: null })

      state.transcript.push({ role: `tool`, toolCallId: call.id, name, ...details, content: result, imageId: null, pending: false })
      messages.push({ role: `tool`, tool_call_id: call.id, content: result })
    }
  }

  // Out of rounds before it wrote an overview
  return ``
}

// Runs the briefing and saves how it went. It never throws: a failure is saved on the briefing.
const executeBriefing = async function (briefing) {
  const state = { transcript: [], notificationCount: 0 }

  // It stops when cancelled, or when it has taken too long
  const timeLimit = AbortSignal.timeout(briefingTimeLimit)
  const signal = AbortSignal.any([briefing.abort.signal, timeLimit])

  let status = `done`
  let overview = null
  let error = null

  try {
    const reply = await runBriefing({ briefingId: briefing.id, user: briefing.user, run: briefing.run, state, signal })

    if (reply !== ``) {
      overview = reply
    }
  } catch (err) {
    status = `failed`

    if (briefing.abort.signal.aborted) {
      error = cancelledError
    } else if (timeLimit.aborted) {
      error = timeLimitError
    } else {
      console.error(`Briefing failed`, err)
      error = err.message
    }
  }

  try {
    const transcript = JSON.stringify(state.transcript)
    finishBriefingRow.run({ id: briefing.id, status, overview, error, transcript, now: new Date().toISOString() })
    deleteOldBriefings.run({ userId: briefing.user.id, keep: keptBriefings })
  } catch (err) {
    console.error(`Saving the briefing failed`, err)
  } finally {
    // Not running any more by the time its watchers' streams end, so the page they reload to
    // shows it finished
    if (running.get(briefing.user.id) === briefing) {
      running.delete(briefing.user.id)
    }

    runs.finishRun(briefing.run)
  }
}

// Starts a briefing for `user` in the background and returns its id. `startedBy` is `schedule`
// or `manual`. A user has one briefing at a time; while theirs is running, its id is returned
// instead.
export const startBriefing = function ({ user, startedBy }) {
  const current = running.get(user.id)

  if (current != null) {
    return current.id
  }

  const id = cuid()

  insertBriefing.run({ id, userId: user.id, startedBy, now: new Date().toISOString() })

  // Not kept with the chats' runs, so scheduled briefings still only wait for chats
  const run = runs.newRun()

  const briefing = { id, user, abort: run.abort, run, finished: null }

  running.set(user.id, briefing)
  briefing.finished = executeBriefing(briefing)

  return id
}

// The run of the user's briefing in progress, for the Briefing page to watch, or null
export const getRun = function (userId) {
  return running.get(userId)?.run ?? null
}

// Stops the user's running briefing, if there is one, and waits until it's saved. It's saved as
// failed, keeping what it did before then: its transcript, and the notifications it sent.
export const cancelBriefing = async function (userId) {
  const briefing = running.get(userId)

  if (briefing == null) {
    return
  }

  briefing.abort.abort()
  await briefing.finished
}

export const isRunning = function (userId) {
  return running.has(userId)
}

export const isScheduleOn = function () {
  return config.briefings.on === true
}

export const getBriefingMinutes = function () {
  return config.briefings.minutes ?? defaultBriefingMinutes
}

// When the user's next scheduled briefing is due: briefingMinutes after their last one started,
// or now when they've never had one. Null while scheduled briefings are off.
export const getNextDue = function (userId) {
  if (isScheduleOn() === false) {
    return null
  }

  const last = selectLastStarted.get({ userId })

  if (last == null) {
    return new Date()
  }

  const interval = getBriefingMinutes() * 60 * 1000
  const lastStart = new Date(last.startedAt).getTime()

  return new Date(lastStart + interval)
}

// Called every minute (see services/cron.js). Starts a scheduled briefing for the user whose is
// most overdue, when one is: one at a time, and not while any briefing is running or a chat is
// replying, so it doesn't compete with anyone for the model; it's tried again next time.
export const runIfDue = function () {
  if (isScheduleOn() === false || running.size > 0 || runs.hasActiveRuns()) {
    return
  }

  const now = Date.now()
  let mostOverdue = null

  for (const user of users.listUsers()) {
    const nextDue = getNextDue(user.id)

    if (nextDue.getTime() > now) {
      continue
    }

    if (mostOverdue == null || nextDue < mostOverdue.nextDue) {
      mostOverdue = { user, nextDue }
    }
  }

  if (mostOverdue == null) {
    return
  }

  startBriefing({ user: mostOverdue.user, startedBy: `schedule` })
}

// The transcript comes back parsed
const toBriefing = function (row) {
  return { ...row, transcript: JSON.parse(row.transcript) }
}

// The user's briefing with that id, or null: another user's reads as none
export const getBriefing = function (userId, id) {
  const row = selectBriefing.get({ userId, id })

  if (row == null) {
    return null
  }

  return toBriefing(row)
}

// The user's most recent briefing that has finished (done or failed), or null
export const getLatest = function (userId) {
  const rows = selectFinished.all({ userId, limit: 1, offset: 0 })

  if (rows.length === 0) {
    return null
  }

  return toBriefing(rows[0])
}

// The user's finished briefings before the latest one, most recent first
export const listEarlier = function (userId, limit) {
  const rows = selectFinished.all({ userId, limit, offset: 1 })
  return rows.map(toBriefing)
}

// Called when the Briefing page is shown, so its nav item stops saying there's something new
export const markViewed = function (userId) {
  settings.set(userId, `briefingViewedAt`, new Date().toISOString())
}

// Whether a briefing of the user's has finished (done or failed) since they last saw the
// Briefing page, for the dot on its nav item
export const hasUnseen = function (userId) {
  const row = selectLastFinishedAt.get({ userId })

  if (row.finishedAt == null) {
    return false
  }

  const viewedAt = settings.get(userId, `briefingViewedAt`)

  if (viewedAt == null) {
    return true
  }

  // Both are ISO dates, which compare in time order as text
  return row.finishedAt > viewedAt
}

export default {
  defaultBriefingMinutes,
  startBriefing,
  cancelBriefing,
  getRun,
  isRunning,
  isScheduleOn,
  getBriefingMinutes,
  getNextDue,
  runIfDue,
  getLatest,
  listEarlier,
  getBriefing,
  markViewed,
  hasUnseen,
}
