import joi from '../services/joi.js'
import tasks from '../services/tasks.js'

const taskFormSchema = joi.object({
  title: joi.string().trim().max(200).required(),
  notes: joi.string().trim().max(4000),
  priority: joi.string().valid(...tasks.priorities),
  // From a date input: YYYY-MM-DD, or empty for no due date
  dueDate: joi.string().trim(),
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

export default {
  readTaskForm,
}
