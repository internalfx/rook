// Reading what the model passed a tool. The arguments arrive as JSON text, which is still
// incomplete while a reply streams in, so these give null rather than throw.

// The arguments the model gave a tool, as an object, or null when they aren't valid JSON yet
export const parseArguments = function (argumentsText) {
  try {
    return JSON.parse(argumentsText)
  } catch (err) {
    return null
  }
}

// One of the arguments the model gave a tool, or null when the arguments aren't valid JSON yet
const readArgument = function (argumentsText, key) {
  const args = parseArguments(argumentsText)
  return args?.[key] ?? null
}

// The prompt the model gave generate_image
export const readImagePrompt = function (argumentsText) {
  return readArgument(argumentsText, `prompt`)
}

// The URL the model gave read_web_page
export const readToolUrl = function (argumentsText) {
  return readArgument(argumentsText, `url`)
}

// The query the model gave web_search, search_memories or find_tasks
export const readSearchQuery = function (argumentsText) {
  return readArgument(argumentsText, `query`)
}

// The title the model gave add_task or update_task
export const readTaskTitle = function (argumentsText) {
  return readArgument(argumentsText, `title`)
}

// The text the model gave save_memory or update_memory
export const readMemoryContent = function (argumentsText) {
  return readArgument(argumentsText, `content`)
}

export default {
  parseArguments,
  readImagePrompt,
  readToolUrl,
  readSearchQuery,
  readTaskTitle,
  readMemoryContent,
}
