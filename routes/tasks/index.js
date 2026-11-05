import tasks from '../../services/tasks.js'
import tools from '../../ai-tools/index.js'
import { readTaskForm, toPageTask } from '../../lib/taskForm.js'

// How many done tasks the page lists
const doneShown = 50

// How many tasks a search shows, closest first, and how long it may take: the first search with
// a new embedding model embeds every task
const searchLimit = 10
const searchTimeout = 1000 * 60 * 2

// The tasks to do, and those done. With ?q=, the tasks closest in meaning to it instead, done
// ones too, found with the embedding model as the chat model finds them.
export const GET = async function (ctx) {
  const userId = ctx.state.user.id
  const zone = ctx.state.user.timeZone
  const q = typeof ctx.query.q === `string` ? ctx.query.q.trim() : ``

  const toPage = function (task) {
    return toPageTask(task, zone)
  }

  let results = null
  let searchError = null

  if (q !== ``) {
    const model = tools.getEmbeddingModel()

    if (model == null) {
      searchError = `Searching by meaning needs an embedding model; name one in config.js.`
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
