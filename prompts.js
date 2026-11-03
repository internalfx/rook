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

  // Said for the user in front of a chat the model started, from a briefing
  briefingOpener: `(You started this conversation from my briefing.)`,

  // In place of an image the user attached, when it isn't sent: it's older than the most recent
  // few, or the chat model can't see images
  olderImage: `(The user attached an image here earlier; it's no longer shown to you.)`,
  unseenImage: `(The user attached an image here, which you can't see.)`,

  // The text of a message that's only images, for writing the chat's title
  imageOnlyMessage: `(The user sent an image.)`,
}

export const memories = {
  // The pinned memories, given at the start of every chat and briefing; `list` is one
  // "- [id] text" line for each
  pinned: ({ list }) => `Things you remember about the user (your pinned memories; the id in brackets is for update_memory and delete_memory):\n${list}`,
}

export const briefing = {
  // The system message of every briefing, with the pinned memories after it
  instructions: `You're preparing a short status update for the user. Look at what you know about them and what's been happening. If memories are duplicated, out of date or contradict each other, fix them. If a recent chat shows the user has done a task, mark it done, with a completion note if the chat says how it went or why it no longer applies; if it shows something they need to do that isn't on their list, add it. Use notify_user only for what's new or noteworthy, never for something you've already notified them about recently unless it has become more urgent. When you're done, reply with a short message, written to the user; they can start a chat from it.`,
}

// The model read_web_page can have pick out a page's main content (Settings → Web pages → Page
// reader). It's trained on this wording, so it's left as its makers wrote it.
export const pageReader = {
  // What a MinerU-HTML model is asked to label the page's blocks with; `html` is the blocks (see
  // ai-tools/mainContent.js). MinerU-HTML v1.1's "short_compact" prompt.
  mineru: ({ html }) => `As an HTML expert, classify elements with "_item_id" as "main" or "other", keeping only the main content and removing nav, metadata, etc.
Guidelines:
"Main": Includes primary content like article text, images in the article, original posts in forums, Q&A questions, and answers.
"Other": Includes navigation, metadata, ads, user info, and related content (e.g., sidebars, timestamps, suggested articles).
Output Format:
Return each _item_id and its corresponding category in the following format:
{_item_id}{category}{_item_id}{category}...
Here, {_item_id} may be 1, 2, 3..., and {category} is either "main" or "other", as shown in the example below:
"1main2other3other4main"
Input HTML:
${html}`,
}

// Each tool's description, and its parameters' descriptions, by tool name. These are what the
// model reads to decide when to use a tool and what to give it. A parameter missing here has no
// description (its choices are listed for the model instead). The briefing's own tool,
// notify_user, is at the end.

// Used by add_task and update_task. Their choices (high, normal, low) are listed for the model.
const priorityHint = `Normal unless the user says it's urgent, important or can wait.`
const dueDateHint = `YYYY-MM-DD. Work out "Friday" with find_weekday and "in 3 weeks" with add_to_date.`

export const tools = {
  get_current_time: {
    description: `Get the current date, time and the user's time zone. Use it whenever the answer depends on today's date or the time, e.g. "tomorrow", someone's age, or whether something has happened yet. For other time zones, use convert_time.`,
  },

  convert_time: {
    description: `Convert a time between time zones, or get the time now somewhere else, instead of working out offsets yourself; it knows daylight saving. E.g. "time in Tokyo?", "3pm my time in London", "how far ahead is Sydney?". Name zones as IANA names (America/New_York) or cities they're named after (Tokyo); for other cities use their zone, e.g. Mumbai is Asia/Kolkata.`,
    parameters: {
      time: `YYYY-MM-DD HH:MM (24-hour), or HH:MM for today. Leave it out for now.`,
      from_zone: `The zone that time is in. Leave it out for the user's.`,
      to_zones: `The zones to convert to. Leave it out for the user's.`,
    },
  },

  calculate: {
    description: `Do arithmetic exactly instead of in your head: totals, splits, tips, percentages, averages. Give the whole sum as one expression, e.g. (84.50 * 1.15) / 3.`,
    parameters: {
      expression: `Using + - * / ^, parentheses, % (15% * 84.50 is 15% of 84.50), and sqrt, abs, floor, ceil, round(x, places), mod(a, b), percent_change(from, to), and sum, mean, median, min, max of a list, e.g. mean(12, 15.5, 9). No thousands separators or units.`,
    },
  },

  days_between: {
    description: `Count the days between two dates, e.g. until a due date or since something happened. It also gives each date's weekday.`,
    parameters: {
      from: `YYYY-MM-DD, or today.`,
      to: `YYYY-MM-DD, or today.`,
    },
  },

  add_to_date: {
    description: `Find the date some days, weeks, months or years before or after another, e.g. "in 3 weeks" or "6 months from today", with its weekday.`,
    parameters: {
      date: `The start date: YYYY-MM-DD, or today.`,
      amount: `How many units, as a whole number; negative to go back.`,
      unit: `What amount counts, e.g. weeks for "in 3 weeks".`,
    },
  },

  // weekday has no description: its choices, monday to sunday, say it all
  find_weekday: {
    description: `Find the date of the next or last given weekday, e.g. "next Friday" or "last Monday". It gives the first one and the one after, since "next Friday" can mean either; if it matters and the user hasn't said, ask.`,
    parameters: {
      from: `The date to count from: YYYY-MM-DD, or today (the default).`,
      direction: `Defaults to after, the next one.`,
    },
  },

  generate_image: {
    description: `Create an image and show it to the user. Use it whenever they ask for a picture, drawing, photo, logo or any other image.`,
    parameters: {
      prompt: `A detailed description of the image, in English: the subject, setting, style, colours and composition.`,
    },
  },

  read_web_page: {
    // `sites` is the sites listed in Settings, each with what can be read there when rook knows
    description: ({ sites }) => `Read a web page as Markdown. Pages on these sites and their subdomains can be read: ${sites}. Use it when the user asks about something on them, and follow links in what it returns to look further.`,
    parameters: {
      url: `The page's full URL.`,
    },
  },

  web_search: {
    description: `Search the web for the top results' titles, links and snippets. Use it for facts you don't know or that may have changed. Add site:example.com to search one site. Only results marked (readable) open with read_web_page; answer from the others' snippets.`,
    parameters: {
      query: `As you'd type it into a search engine.`,
    },
  },

  save_memory: {
    description: `Save something worth knowing in future chats: about the user (name, family, pets, work, likes, plans), or that they ask you to remember. If a memory about it already exists, change it with update_memory instead.`,
    parameters: {
      content: `One short sentence that makes sense on its own, e.g. "The user's dog is called Biscuit."`,
      pinned: `true only for what matters in almost every chat, like the user's name or how they like answers; pinned memories are given to you at the start of every chat. false for the rest, which you find with search_memories.`,
    },
  },

  search_memories: {
    description: `Search your saved memories by meaning. Use it whenever the user mentions something you may have been told before, or asks what you remember, before saying you don't know. Pinned memories aren't searched; you already have them.`,
    parameters: {
      query: `A few words, e.g. "the user's dog".`,
    },
  },

  // The ids of memories and tasks have no description; their names say it all
  update_memory: {
    description: `Change a saved memory when it's corrected or out of date. Give its id (from search_memories or the pinned list) and only what changes.`,
    parameters: {
      content: `The new text, as one short sentence.`,
      pinned: `Whether it's pinned, as for save_memory.`,
    },
  },

  delete_memory: {
    description: `Delete a saved memory when the user asks you to forget it, or it's no longer true or useful. Give its id (from search_memories or the pinned list).`,
  },

  add_task: {
    description: `Add a task to the user's to-do list, when they ask you to or mention something they have to do. If it might already be there, check with find_tasks first.`,
    parameters: {
      title: `A few words starting with a verb, e.g. "Book the dentist".`,
      notes: `Details worth keeping: who, where, what to bring.`,
      priority: priorityHint,
      due_date: dueDateHint,
    },
  },

  find_tasks: {
    description: `Look at the user's to-do list: with no query, every open task, most important first; with a query, the tasks matching its words or meaning. Use it when the user asks what they have to do, before adding a task that may exist, and to get ids for update_task and complete_task.`,
    parameters: {
      query: `Words to look for, e.g. "dentist".`,
      include_done: `true to include tasks already done.`,
    },
  },

  // title has no description either
  update_task: {
    description: `Change a task's title, notes, priority or due date. Give its id (from find_tasks) and only what changes. To mark it done, use complete_task.`,
    parameters: {
      notes: `Replaces the old notes.`,
      priority: priorityHint,
      due_date: `${dueDateHint} An empty string removes it.`,
    },
  },

  complete_task: {
    description: `Mark a task done when the user has done it or it no longer applies, or put it back on the list. Give its id (from find_tasks).`,
    parameters: {
      done: `false puts it back on the list. Defaults to true.`,
      note: `When marking it done, a short note: what was done, anything left over, or why it no longer applies. Leave it out to keep any note it has.`,
    },
  },

  read_slack: {
    description: `Read the latest messages in one of the user's Slack conversations at work, with replies to its newest threads. Use it for what's been said, asked or decided there.`,
    parameters: {
      since: `YYYY-MM-DD to read from that day on. Leave it out for the latest messages.`,
    },
  },

  search_slack: {
    description: ({ conversations }) => `Search the user's Slack conversations at work: ${conversations}. Only these are searched.`,
    parameters: {
      query: `Words to find. Slack's search syntax works, e.g. "exact phrase" or after:2026-11-01.`,
    },
  },

  // Briefings only
  notify_user: {
    description: `Push a notification to the user's phone about something important: new, or more urgent than when you last notified them (e.g. a task due today still not done). Use it sparingly; most briefings need none, and never repeat a recent notification unless it has become more urgent.`,
    parameters: {
      title: `A few words, e.g. "Passport renewal is overdue".`,
      message: `One or two sentences, written to the user.`,
      priority: `high only when it can't wait, e.g. due within hours. Defaults to normal.`,
    },
  },
}

export default {
  chat,
  memories,
  briefing,
  pageReader,
  tools,
}
