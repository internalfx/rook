
import Bun from 'bun'
import config from '../configure.js'
import cuid from 'cuid'
import fs from 'node:fs'
import path from 'node:path'
import { mkdirp } from 'mkdirp'

// Generated images are PNG files named by id: data/images/<id>.png
export const imagesDir = path.join(config.dataDir, `images`)

mkdirp.sync(imagesDir)

// Ids come from cuid(); anything else is refused before it gets near the filesystem
export const isImageId = function (id) {
  return typeof id === `string` && /^[a-z0-9]+$/.test(id)
}

export const imageFileName = function (id) {
  return `${id}.png`
}

export const saveImage = async function (pngBuffer) {
  const id = cuid()
  const filePath = path.join(imagesDir, imageFileName(id))

  await Bun.write(filePath, pngBuffer)

  return id
}

export const deleteImages = function (ids) {
  for (const id of ids) {
    if (isImageId(id) === false) {
      continue
    }

    const filePath = path.join(imagesDir, imageFileName(id))
    fs.rmSync(filePath, { force: true })
  }
}

export default {
  imagesDir,
  isImageId,
  imageFileName,
  saveImage,
  deleteImages,
}
