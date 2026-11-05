
import cuid from 'cuid'
import db from './db.js'
import images from './images.js'

// Each chat belongs to one user (userId). Its messages belong to it, so a chat is looked up with
// its user's id (getChat), and anything about its messages takes the chat's id from there.

const selectChats = db.query(`SELECT id, title, updatedAt FROM chats WHERE userId = $userId ORDER BY updatedAt DESC`)
const selectChat = db.query(`SELECT * FROM chats WHERE id = $id AND userId = $userId`)
const selectRecentChats = db.query(`
  SELECT id, title, updatedAt FROM chats WHERE userId = $userId ORDER BY updatedAt DESC LIMIT $limit
`)
const insertChat = db.query(`
  INSERT INTO chats (id, userId, title, createdAt, updatedAt)
  VALUES ($id, $userId, NULL, $now, $now)
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
// Whether an image is in one of the user's chats: made by a tool there (imageId), or attached to
// a message (imageIds, a JSON array)
const selectOwnsImage = db.query(`
  SELECT 1 FROM chatMessages JOIN chats ON chats.id = chatMessages.chatId
  WHERE chats.userId = $userId AND (
    chatMessages.imageId = $imageId OR (
      chatMessages.imageIds IS NOT NULL
      AND EXISTS (SELECT 1 FROM json_each(chatMessages.imageIds) WHERE value = $imageId)
    )
  )
  LIMIT 1
`)

export const listChats = function (userId) {
  return selectChats.all({ userId })
}

// The user's chat with that id, or null: another user's reads as no chat
export const getChat = function (userId, id) {
  return selectChat.get({ userId, id }) ?? null
}

// The user's `limit` most recently active chats, most recent first, for briefings to look over
export const listRecentChats = function (userId, limit) {
  return selectRecentChats.all({ userId, limit })
}

// Whether the image (see services/images.js) is in one of the user's chats
export const ownsImage = function (userId, imageId) {
  return selectOwnsImage.get({ userId, imageId }) != null
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

// A chat holds only its conversation; its models and tools come from config.js each time
export const createChat = function (userId) {
  const id = cuid()
  const now = new Date().toISOString()

  insertChat.run({ id, userId, now })

  return getChat(userId, id)
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
// and those the user attached. The caller has checked the chat is the user's (getChat).
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
  ownsImage,
  getMessages,
  createChat,
  touchChat,
  setTitle,
  addMessage,
  deleteChat,
}
