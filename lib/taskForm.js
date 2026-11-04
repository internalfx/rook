import dayjs from 'dayjs'
import joi from '../services/joi.js'
import tasks from '../services/tasks.js'

const taskFormSchema = joi.object({
  title: joi.string().trim().max(200).required(),
  notes: joi.string().trim().max(4000),
  priority: joi.string().valid(...tasks.priorities),
  // From a date input: YYYY-MM-DD, or empty for no due date
  dueDate: joi.string().trim(),
  // Read by readReturnTo
  returnTo: joi.string(),
})

// The Tasks page's add and edit forms => { title, notes, priority, dueDate }. Throws an error
// whose message is shown to the user when something isn't valid.
export const readTaskForm = async function (body) {
  const args = await taskFormSchema.validateAsync(body)

  if (args.dueDate != null && tasks.isValidDay(args.dueDate) === false) {
    throw new Error(`"${args.dueDate}" isn't a date.`)
  }

  return {
    title: args.title,
    notes: args.notes ?? ``,
    priority: args.priority ?? `normal`,
    dueDate: args.dueDate ?? null,
  }
}

// Where a task's form on the Tasks page goes back to: the `returnTo` it was sent with, so a
// search stays open (/tasks, or /tasks with its ?q=), or /tasks when it's anything else
export const readReturnTo = function (body) {
  const returnTo = body?.returnTo
  const isTasksPage = returnTo === `/tasks` || (typeof returnTo === `string` && returnTo.startsWith(`/tasks?`))

  return isTasksPage ? returnTo : `/tasks`
}

// A task as the Tasks page shows it: its due date in words ("Tomorrow", "Overdue · Mon 2 Nov"),
// how soon that is (dueState), and the day it was done. Discuss words a task the same way.
export const toPageTask = function (task) {
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

export default {
  readTaskForm,
  readReturnTo,
  toPageTask,
}
