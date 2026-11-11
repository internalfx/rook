import dayjs from 'dayjs'
import tasks from '../../lib/tasks.js'
import taskRequests from '../../lib/taskRequests.js'
import tools from '../../ai-tools/index.js'
import { readTaskForm, toPageTask } from '../../lib/taskForm.js'

// How many done tasks the page lists
const doneShown = 50

// How many tasks a search shows, closest first, and how long it may take: the first search with
// a new embedding model embeds every task
const searchLimit = 10
const searchTimeout = 1000 * 60 * 2

// The tasks to do, and those done. With ?q=, the tasks closest in meaning to it instead, done
// ones too, found with the embedding model as the chat model finds them. Around them, the task
// requests between the user and the others on this rook (lib/taskRequests.js): those held for the
// user to answer and those their model declined lately, and those the user has sent.
export const GET = async function (ctx) {
  const userId = ctx.state.user.id
  const zone = ctx.state.user.timeZone
  const q = typeof ctx.query.q === `string` ? ctx.query.q.trim() : ``

  const toPage = function (task) {
    return toPageTask(task, zone)
  }

  // A request as the page shows it: its due date and done date worded as a task's are, and the
  // days it was sent and answered, in the user's time zone
  const toPageRequest = function (request) {
    const pageRequest = toPageTask({ ...request, doneAt: request.doneAt ?? null }, zone)

    return {
      ...pageRequest,
      sentLabel: dayjs(request.createdAt).tz(zone).format(`D MMM`),
      answeredLabel: request.answeredAt == null ? null : dayjs(request.answeredAt).tz(zone).format(`D MMM`),
    }
  }

  const recentSince = new Date(Date.now() - taskRequests.recentDays * 24 * 60 * 60 * 1000)

  const heldRequests = taskRequests.listHeld(userId).map(toPageRequest)

  // Those the model declined can still be accepted; one the user declined themselves is gone
  const declinedRequests = taskRequests.listAnswered(userId, recentSince).filter(function (request) {
    return request.status === `declined` && request.answeredBy === `model`
  }).map(toPageRequest)

  const sentRequests = taskRequests.listSent(userId).map(toPageRequest)

  const sentOpenCount = sentRequests.filter(function (request) {
    return request.state === `reviewing` || request.state === `waiting` || request.state === `accepted`
  }).length

  let results = null
  let searchError = null

  if (q !== ``) {
    const model = tools.getEmbeddingModel()

    if (model == null) {
      searchError = `Searching by meaning needs an embedding model; an admin chooses one in Admin → Models.`
    } else {
      try {
        const closest = await tasks.searchByMeaning({ userId, query: q, model, includeDone: true, limit: searchLimit, signal: AbortSignal.timeout(searchTimeout) })
        results = closest.map(toPage)
      } catch (err) {
        console.error(err)
        searchError = `Couldn't search: ${err.message}`
      }
    }
  }

  const openTasks = tasks.listOpen(userId).map(toPage)
  const doneTasks = tasks.listDone(userId, doneShown).map(toPage)

  const dueCount = openTasks.filter(function (task) {
    return task.dueState === `overdue` || task.dueState === `today`
  }).length

  // Where a task's forms come back to, so a search stays open
  const returnTo = q === `` ? `/tasks` : `/tasks?q=${encodeURIComponent(q)}`

  ctx.body = ctx.nunjucks(`tasks/index`, {
    openTasks,
    doneTasks,
    doneCount: tasks.countDone(userId),
    dueCount,
    maxDoneNoteLength: tasks.maxDoneNoteLength,
    doneKeptDays: tasks.doneKeptDays,
    isTasksOn: tools.isTasksOn(),
    heldRequests,
    declinedRequests,
    sentRequests,
    sentOpenCount,
    maxReasonLength: taskRequests.maxReasonLength,
    recentDays: taskRequests.recentDays,
    q,
    results,
    searchError,
    returnTo,
  })
}

// Form POST from the "Add a task" box; a task the user adds isn't from any chat
export const POST = async function (ctx) {
  let fields

  try {
    fields = await readTaskForm(ctx.request.body)
  } catch (err) {
    ctx.addFlash(err.message, `error`)
    return ctx.redirect(`/tasks`)
  }

  tasks.createTask({ ...fields, userId: ctx.state.user.id, chatId: null })

  return ctx.redirect(`/tasks`)
}
