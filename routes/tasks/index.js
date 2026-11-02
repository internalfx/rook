import dayjs from 'dayjs'
import tasks from '../../services/tasks.js'
import tools from '../../ai-tools/index.js'
import { readTaskForm } from '../../lib/taskForm.js'

// How many done tasks the page lists
const doneShown = 50

// A task as the page shows it: its due date in words ("Tomorrow", "Overdue · Mon 2 Nov"), how
// soon that is (dueState), and the day it was done
const toPageTask = function (task) {
  const dueState = tasks.dueState(task)

  let dueLabel = null

  if (task.dueDate != null) {
    // dayjs reads a plain YYYY-MM-DD as a day in the server's time zone
    const due = dayjs(task.dueDate)
    const isThisYear = due.year() === dayjs().year()

    dueLabel = due.format(isThisYear ? `ddd D MMM` : `ddd D MMM YYYY`)

    if (dueState === `today`) {
      dueLabel = `Today`
    } else if (dueState === `tomorrow`) {
      dueLabel = `Tomorrow`
    } else if (dueState === `overdue`) {
      dueLabel = `Overdue · ${dueLabel}`
    }
  }

  let doneLabel = null

  if (task.doneAt != null) {
    doneLabel = dayjs(task.doneAt).format(`D MMM YYYY`)
  }

  return { ...task, dueState, dueLabel, doneLabel }
}

export const GET = async function (ctx) {
  const openTasks = tasks.listOpen().map(toPageTask)
  const doneTasks = tasks.listDone(doneShown).map(toPageTask)

  const dueCount = openTasks.filter(function (task) {
    return task.dueState === `overdue` || task.dueState === `today`
  }).length

  ctx.body = ctx.nunjucks(`tasks/index`, {
    openTasks,
    doneTasks,
    doneCount: tasks.countDone(),
    dueCount,
    maxDoneNoteLength: tasks.maxDoneNoteLength,
    isTasksOn: tools.isTasksOn(),
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

  tasks.createTask({ ...fields, chatId: null })

  return ctx.redirect(`/tasks`)
}
