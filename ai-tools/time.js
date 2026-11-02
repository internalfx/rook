import prompts from '../prompts.js'

// get_current_time: the date and time now, which the model can't know otherwise

// Models only know the date their training ended, so they're given a way to ask
const currentTimeTool = {
  type: `function`,
  function: {
    name: `get_current_time`,
    description: prompts.tools.get_current_time.description,
    parameters: {
      type: `object`,
      properties: {},
    },
  },
}

// The time now in the server's time zone, which is the owner's, written out so the model can't
// misread it, with the ISO form for working things out. Also told to briefings.
export const describeCurrentTime = function () {
  const now = new Date()
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const localTime = now.toLocaleString(`en-US`, { dateStyle: `full`, timeStyle: `long`, timeZone })

  return `It's ${localTime} (time zone ${timeZone}). In UTC: ${now.toISOString()}`
}

const runGetCurrentTime = function () {
  return { content: describeCurrentTime(), imageId: null }
}

export const tools = [
  {
    name: `get_current_time`,
    // Always offered; it has nothing to set up
    settings: () => ({}),
    definition: () => currentTimeTool,
    run: runGetCurrentTime,
  },
]

export default {
  describeCurrentTime,
  tools,
}
