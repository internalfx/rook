import Bun from 'bun'
import config from '../configure.js'
import cuid from 'cuid'
import fs from 'node:fs'
import path from 'node:path'
import { mkdirp } from 'mkdirp'

// Images are files named by id: data/images/<id>.png for those the model generates, and
// data/images/<id>.jpg for those the user attaches to a message (the chat page sends them as
// JPEG, see templates/chat/index.njk)
export const imagesDir = path.join(config.dataDir, `images`)

mkdirp.sync(imagesDir)

const extensions = [`png`, `jpg`]

// Ids come from cuid(); anything else is refused before it gets near the filesystem
export const isImageId = function (id) {
  return typeof id === `string` && /^[a-z0-9]+$/.test(id)
}

// The image's file name, whichever kind it is, or null when there's no such image
export const findImageFile = function (id) {
  if (isImageId(id) === false) {
    return null
  }

  for (const extension of extensions) {
    const fileName = `${id}.${extension}`

    if (fs.existsSync(path.join(imagesDir, fileName))) {
      return fileName
    }
  }

  return null
}

const saveFile = async function (buffer, extension) {
  const id = cuid()

  await Bun.write(path.join(imagesDir, `${id}.${extension}`), buffer)

  return id
}

// A generated image, as PNG
export const saveImage = async function (pngBuffer) {
  return saveFile(pngBuffer, `png`)
}

// An image the user attached, already checked to be a JPEG
export const saveUpload = async function (jpegBuffer) {
  return saveFile(jpegBuffer, `jpg`)
}

// The image as the model is sent it: "data:image/jpeg;base64,…". Null when it's gone.
export const readImageDataUrl = async function (id) {
  const fileName = findImageFile(id)

  if (fileName == null) {
    return null
  }

  const bytes = await Bun.file(path.join(imagesDir, fileName)).arrayBuffer()
  const type = fileName.endsWith(`.png`) ? `image/png` : `image/jpeg`

  return `data:${type};base64,${Buffer.from(bytes).toString(`base64`)}`
}

export const deleteImages = function (ids) {
  for (const id of ids) {
    if (isImageId(id) === false) {
      continue
    }

    for (const extension of extensions) {
      fs.rmSync(path.join(imagesDir, `${id}.${extension}`), { force: true })
    }
  }
}

export default {
  imagesDir,
  isImageId,
  findImageFile,
  saveImage,
  saveUpload,
  readImageDataUrl,
  deleteImages,
}
