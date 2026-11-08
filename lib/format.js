
// 262144 => "256K"
export const formatContextLength = function (tokens) {
  if (tokens == null) {
    return null
  }

  const thousands = Math.round(tokens / 1024)

  return `${thousands}K`
}

// Text as a markdown quote: each line prefixed with "> ", so a Discuss opener can show a task's
// notes, a memory or a notification's message set apart from the model's own words
export const quoteMarkdown = function (text) {
  const lines = text.split(`\n`).map(function (line) {
    return `> ${line}`
  })

  return lines.join(`\n`)
}

export default {
  formatContextLength,
  quoteMarkdown,
}
