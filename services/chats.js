
import cuid from 'cuid'
import db from './db.js'
import images from './images.js'

const selectChats = db.query(`SELECT id, title, updatedAt FROM chats ORDER BY updatedAt DESC`)
const selectChat = db.query(`SELECT * FROM chats WHERE id = $id`)
const selectRecentChats = db.query(`
  SELECT id, title, updatedAt FROM chats ORDER BY updatedAt DESC LIMIT $limit
`)
const insertChat = db.query(`
  INSERT INTO chats (id, title, createdAt, updatedAt)
  VALUES ($id, NULL, $now, $now)
`)
const updateChatActivity = db.query(`UPDATE chats SET updatedAt = $now WHERE id = $id`)
const updateChatTitle = db.query(`UPDATE chats SET title = $title WHERE id = $id`)
const deleteChatRow = db.query(`DELETE FROM chats WHERE id = $id`)

const selectMessages = db.query(`
  SELECT role, content, reasoning, toolCalls, toolCallId, imageId, imageIds
  FROM chatMessages WHERE chatId = $chatId ORDER BY id
`)
const insertMessage = db.query(`
  INSERT INTO chatMessages (chatId, role, content, reasoning, toolCalls, toolCallId, imageId, imageIds, createdAt)
  VALUES ($chatId, $role, $content, $reasoning, $toolCalls, $toolCallId, $imageId, $imageIds, $now)
`)
const selectImageIds = db.query(`
  SELECT imageId, imageIds FROM chatMessages
  WHERE chatId = $chatId AND (imageId IS NOT NULL OR imageIds IS NOT NULL)
`)

export const listChats = function () {
  return selectChats.all()
}

export const getChat = function (id) {
  return selectChat.get({ id }) ?? null
}

// The `limit` most recently active chats, most recent first, for briefings to look over
export const listRecentChats = function (limit) {
  return selectRecentChats.all({ limit })
}

// toolCalls comes back parsed: an array in the OpenAI format, or null. So does imageIds: the ids
// of the images the user attached, or null.
export const getMessages = function (chatId) {
  const rows = selectMessages.all({ chatId })

  const messages = rows.map(function (row) {
    let toolCalls = null
    let imageIds = null

    if (row.toolCalls != null) {
      toolCalls = JSON.parse(row.toolCalls)
    }

    if (row.imageIds != null) {
      imageIds = JSON.parse(row.imageIds)
    }

    return { ...row, toolCalls, imageIds }
  })

  return messages
}

// A chat holds only its conversation; its models and tools come from Settings each time
export const createChat = function () {
  const id = cuid()
  const now = new Date().toISOString()

  insertChat.run({ id, now })

  return getChat(id)
}

// Moves the chat to the top of the list
export const touchChat = function (id) {
  const now = new Date().toISOString()

  updateChatActivity.run({ id, now })
}

export const setTitle = function (id, title) {
  updateChatTitle.run({ id, title })
}

export const addMessage = function ({
  chatId,
  role,
  content,
  reasoning = ``,
  toolCalls = null,
  toolCallId = null,
  imageId = null,
  imageIds = null,
}) {
  const now = new Date().toISOString()

  let toolCallsText = null
  let imageIdsText = null

  if (toolCalls != null) {
    toolCallsText = JSON.stringify(toolCalls)
  }

  if (imageIds != null && imageIds.length > 0) {
    imageIdsText = JSON.stringify(imageIds)
  }

  insertMessage.run({ chatId, role, content, reasoning, toolCalls: toolCallsText, toolCallId, imageId, imageIds: imageIdsText, now })
}

// Its messages go with it (ON DELETE CASCADE), and so do the image files: those the model made
// and those the user attached
export const deleteChat = function (id) {
  const imageRows = selectImageIds.all({ chatId: id })

  const imageIds = imageRows.flatMap(function (row) {
    const ids = row.imageIds == null ? [] : JSON.parse(row.imageIds)

    return row.imageId == null ? ids : [row.imageId, ...ids]
  })

  deleteChatRow.run({ id })
  images.deleteImages(imageIds)
}

export default {
  listChats,
  getChat,
  listRecentChats,
  getMessages,
  createChat,
  touchChat,
  setTitle,
  addMessage,
  deleteChat,
}
