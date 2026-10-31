-- A chat keeps the tools it was created with, and their settings, for its whole life: a JSON object
-- keyed by tool name, e.g. {"generate_image":{"model":"SDXL-Turbo"}}. {} means no tools.
-- (chats.model is likewise fixed when the chat is created; Settings only affect new chats.)
-- Changing them mid-chat would change the start of the prompt, so the model would see a tool
-- appear or vanish, and the server's prompt cache would have to reprocess the whole conversation.

ALTER TABLE chats ADD COLUMN tools TEXT NOT NULL DEFAULT '{}';
