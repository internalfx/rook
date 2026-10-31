
// 262144 => "256K"
export const formatContextLength = function (tokens) {
  if (tokens == null) {
    return null
  }

  const thousands = Math.round(tokens / 1024)

  return `${thousands}K`
}

export default {
  formatContextLength,
}
