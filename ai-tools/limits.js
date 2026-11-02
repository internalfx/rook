// Limits on the model's tool use, shared by chats (routes/chat/send.js) and briefings
// (services/briefings.js)

// How many times the model can call each tool per message or briefing. Each tool counts on its
// own, so using up web searches doesn't stop it saving a memory. Calls over the limit are
// answered as not run, and the model is told why.
export const maxCallsPerTool = 10

// How many replies the model gets per message or briefing, counting the ones after each round of
// tool calls. A safety net for a model that keeps calling tools whatever it's told; tool calls in
// the last round are answered as not run.
export const maxRounds = 20

// What the model is told about a call over maxCallsPerTool. `per` is what the limit is for:
// `message` in chats, `briefing` in briefings.
export const describeCallLimit = function (name, per = `message`) {
  return `Not run: ${name} can be used at most ${maxCallsPerTool} times for one ${per}. Answer with what you have, or use another tool.`
}

export default {
  maxCallsPerTool,
  maxRounds,
  describeCallLimit,
}
