// The text rook gives the model, in one place so it's easy to tune. Saving this file restarts the
// dev server, so changes apply straight away.
//
// A prompt written as ({ name }) => `…${name}…` has `name` filled in by the code; keep the ${…}.
// Tool results, and the context a briefing is given (memories, tasks, recent chats), are worded
// in the code: ai-tools/ and services/briefings.js.

export const chat = {
  // Starts every chat as the system message, with the pinned memories after it. An empty prompt
  // sends just the memories.
  system: ({ appName, ownerName }) => `You're ${appName}, the self-hosted personal assistant of ${ownerName}. Short answers are preferred. Always say less than necessary. Answer clearly and to the point. Do not be verbose. When a tool can answer better than a guess (the time, a sum, a date, a memory, a task, a web page), use it.`,

  // Asks for a new chat's title, from the start of the conversation
  title: `Write a short title, at most 6 words, summarizing this conversation. Reply with only the title, no quotes or punctuation at the end.`,

  // Said for the user in front of a chat the model started, from a briefing suggestion
  briefingOpener: `(You started this conversation from my briefing.)`,
}

export const memories = {
  // The pinned memories, given at the start of every chat and briefing; `list` is one
  // "- [id] text" line for each
  pinned: ({ list }) => `Things you remember about the user (your pinned memories; the id in brackets is for update_memory and delete_memory):\n${list}`,
}

export const briefing = {
  // The system message of every briefing, with the pinned memories after it
  instructions: ({ maxSuggestions }) => `You're preparing a short status update for the user. Look at what you know about them and what's been happening. Only suggest what's genuinely useful; none is fine. If memories are duplicated, out of date or contradict each other, fix them. If a recent chat shows the user has done a task, mark it done, with a completion note if the chat says how it went or why it no longer applies; if it shows something they need to do that isn't on their list, add it. Compare with your previous briefing and your recent history: don't repeat suggestions the user dismissed or already discussed unless something has changed, and use notify_user only for what's new or noteworthy, never for something you've already notified them about recently unless it has become more urgent. When you're done, reply with an short message, written to the user.`,
  // instructions: ({ maxSuggestions }) => `You're preparing a short status update for the user. Look at what you know about them and what's been happening, and suggest up to ${maxSuggestions} things worth raising: follow-ups on recent conversations, reminders about tasks that are overdue or due soon, ideas, or questions that would fill gaps in what you know about them. For each, call add_suggestion with a short title and the message you'd open the conversation with, written to the user. Only suggest what's genuinely useful; none is fine. If memories are duplicated, out of date or contradict each other, fix them. If a recent chat shows the user has done a task, mark it done, with a completion note if the chat says how it went or why it no longer applies; if it shows something they need to do that isn't on their list, add it. Compare with your previous briefing and your recent history: don't repeat suggestions the user dismissed or already discussed unless something has changed, and use notify_user only for what's new or noteworthy, never for something you've already notified them about recently unless it has become more urgent. When you're done, reply with an short overview, written to the user.`,
}

// Each tool's description, and its parameters' descriptions, by tool name. These are what the
// model reads to decide when to use a tool and what to give it. A parameter missing here has no
// description (its choices are listed for the model instead). The briefing's own tools,
// add_suggestion and notify_user, are at the end.

// Used by save_memory and update_memory
const pinnedHint = `true only for things that matter in almost every conversation, like the user's name or how they like answers written; those are given to you at the start of every chat. false for everything else, which you find with search_memories when it's relevant.`

// Used by add_task and update_task
const priorityHint = `high, normal or low. Use normal unless the user says it's urgent, important or can wait.`
const dueDateHint = `The day it's due, as YYYY-MM-DD. Work out dates like "Friday" with find_weekday and "in 3 weeks" with add_to_date; both count from today.`

export const tools = {
  get_current_time: {
    description: `Get the current date, time and time zone. Use it whenever the answer depends on today's date or the time: "today", "tomorrow" or "this week", how long until or since something, someone's age, or whether something has happened yet.`,
  },

  calculate: {
    description: `Work out arithmetic exactly instead of in your head: totals, splits, tips, prices, percentages, averages. Give the whole sum as one expression, e.g. (84.50 * 1.15) / 3.`,
    parameters: {
      expression: `The sum to work out. It can use + - * / ^ and parentheses; 15% means 0.15, so 15% * 84.50 is 15% of 84.50; and the functions sqrt(x), abs(x), floor(x), ceil(x), round(x, places), mod(a, b) for a remainder, percent_change(from, to), and sum, mean, median, min and max of a list, e.g. mean(12, 15.5, 9). Write numbers without thousands separators or units.`,
    },
  },

  days_between: {
    description: `Count the days from one date to another, e.g. how long until a due date or since something happened. It also gives each date's day of the week.`,
    parameters: {
      from: `The first date, as YYYY-MM-DD, or today.`,
      to: `The second date, as YYYY-MM-DD, or today.`,
    },
  },

  add_to_date: {
    description: `Find the date some days, weeks, months or years before or after another, e.g. a due date "in 3 weeks" or "6 months from today". It also gives the day of the week.`,
    parameters: {
      date: `The date to start from, as YYYY-MM-DD, or today.`,
      amount: `How many, as a whole number; negative to go back.`,
    },
  },

  find_weekday: {
    description: `Find the date of the next or last given day of the week, e.g. "next Friday", "this Saturday" or "last Monday". It gives the first one and the one after it, since "next Friday" can mean either; if it matters and the user hasn't said which, ask.`,
    parameters: {
      from: `The date to count from, as YYYY-MM-DD, or today, the default.`,
      direction: `after, the default, for the next one; before for the last one.`,
    },
  },

  generate_image: {
    description: `Create an image from a text description and show it to the user. Use it whenever the user asks for a picture, drawing, illustration, photo, logo or any other image.`,
    parameters: {
      prompt: `A detailed description of the image, in English: the subject, setting, style, colours and composition.`,
    },
  },

  read_web_page: {
    // `sites` is the sites listed in Settings, each with what can be read there when rook knows
    description: ({ sites }) => `Read a web page and get its content as Markdown. You can read pages on these sites, and their subdomains: ${sites}. Use it whenever the user asks about something on these sites, and follow the URLs in what it returns to look further.`,
    parameters: {
      url: `The full URL of the page to read.`,
    },
  },

  web_search: {
    description: `Search the web with DuckDuckGo and get the top results: each one's title, link and a short snippet. Use it to find pages or facts you don't know, including recent ones. Add site:example.com to the query to search one site. Results marked (readable) can be opened with read_web_page; the others can't be opened, so answer from their snippets.`,
    parameters: {
      query: `What to search for, as you'd type it into a search engine.`,
    },
  },

  save_memory: {
    description: `Save a memory: something about the user, or something they asked you to remember, kept for every future chat. Save one when the user tells you something worth knowing later (their name, family, pets, work, likes, plans) or asks you to remember something. If you already have a memory about it, change that one with update_memory instead of saving another.`,
    parameters: {
      content: `The memory as one short sentence that makes sense on its own, e.g. "The user's dog is called Biscuit."`,
      pinned: pinnedHint,
    },
  },

  search_memories: {
    description: `Search your saved memories by meaning, for things the user told you in earlier chats. Use it whenever the user mentions something you might have been told before, or asks what you remember, before saying you don't know. Pinned memories aren't searched; they're already given to you at the start of the chat.`,
    parameters: {
      query: `What to look for, in a few words, e.g. "the user's dog".`,
    },
  },

  update_memory: {
    description: `Change a saved memory, when the user corrects it or it's out of date. Give its id (from search_memories, or the pinned list at the start of the chat) and whatever changes.`,
    parameters: {
      id: `The memory's id.`,
      content: `The memory's new text, as one short sentence. Leave it out to keep the text.`,
      pinned: `${pinnedHint} Leave it out to keep it as it is.`,
    },
  },

  delete_memory: {
    description: `Delete a saved memory, when the user asks you to forget it, it's no longer true, or no longer useful. Give its id (from search_memories, or the pinned list at the start of the chat).`,
    parameters: {
      id: `The memory's id.`,
    },
  },

  add_task: {
    description: `Add a task to the user's to-do list: something they need to get done. Add one when they ask you to, or tell you about something they have to do. Check with find_tasks first if it might already be on the list.`,
    parameters: {
      title: `What needs doing, in a few words starting with a verb, e.g. "Book the dentist".`,
      notes: `Any details worth keeping: who, where, what to bring. Leave it out if there are none.`,
      priority: priorityHint,
      due_date: `${dueDateHint} Leave it out if there's no date.`,
    },
  },

  find_tasks: {
    description: `Look at the user's to-do list. With no query, lists every task still to do, most important first. With a query, finds the tasks whose title or notes contain its words, or are close to it in meaning. Use it when the user asks what they have to do, before adding a task that may be there already, and to get a task's id for update_task or complete_task.`,
    parameters: {
      query: `Words to look for, e.g. "dentist". Leave it out to list every open task.`,
      include_done: `true to also look through tasks already done. Defaults to false.`,
    },
  },

  update_task: {
    description: `Change a task: its title, notes, priority or due date. Give its id (from find_tasks) and whatever changes. To mark it done, use complete_task instead.`,
    parameters: {
      id: `The task's id.`,
      title: `The new title. Leave it out to keep it.`,
      notes: `The new notes, replacing the old ones. Leave it out to keep them.`,
      priority: priorityHint,
      due_date: `${dueDateHint} An empty string removes the due date. Leave it out to keep it.`,
    },
  },

  complete_task: {
    description: `Mark a task done when the user says they've done it, or it no longer applies (say why in note), or put it back on the list. Give its id (from find_tasks).`,
    parameters: {
      id: `The task's id.`,
      done: `true to mark it done (the default), false to put it back on the to-do list.`,
      note: `When marking it done: a short note on how it went, for later, e.g. what was actually done, anything left over, or that it no longer applied and why. Leave it out to keep any note it has.`,
    },
  },

  // Briefings only
  add_suggestion: {
    description: `Add a suggestion to the briefing: something you'd like to talk to the user about. They see its title on a card, and if they choose to discuss it, a chat opens with your message as the first thing said.`,
    parameters: {
      title: `A few words saying what it's about, e.g. "Biscuit's vet appointment".`,
      message: `What you'd open the conversation with, written to the user, as you'd say it in a chat.`,
    },
  },

  // Briefings only
  notify_user: {
    description: `Notify the user of something important they should know about now: new since your previous briefing, or more urgent than it was (e.g. a task due today that's still not done). It's pushed to their phone, so use it sparingly; most briefings need none. Never notify about something already in your recent notifications unless it has become more urgent.`,
    parameters: {
      title: `A few words saying what it's about, e.g. "Passport renewal is overdue".`,
      message: `One or two sentences, written to the user.`,
      priority: `high only when it can't wait, e.g. something due within hours. Defaults to normal.`,
    },
  },
}

export default {
  chat,
  memories,
  briefing,
  tools,
}
