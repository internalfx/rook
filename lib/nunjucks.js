import _ from 'lodash'
import Bun from 'bun'
import config from '../configure.js'
import njk from 'nunjucks'
// import path from 'node:path'
// import fsp from 'node:fs/promises'
import { watch } from 'node:fs'
import { importDirectory, collapse } from './utils.js'
// import editor from './renderEditor.js'

let templates = {}

const loadTemplates = async function () {
  const templatePaths = collapse(await importDirectory(config.templateDir, /(.+)\.njk$/))

  const templateCode = {}

  for (const [key, path] of Object.entries(templatePaths)) {
    templateCode[key] = await Bun.file(path).text()
  }

  templates = templateCode
}

await loadTemplates()

const MyLoader = njk.Loader.extend({
  init: function () {
    if (config.isDevelopment) {
      watch(config.templateDir, { recursive: true }, (event, filename) => {
        console.log(`RELOAD NUNJUCKS TEMPLATES`)
        loadTemplates().catch(console.log)
      })
    }

    // this.emit(`update`, `main`)
  },
  getSource: function (name) {
    if (templates[name] == null) {
      throw new Error(`Template "${name}" NOT FOUND!!!`)
    }

    return {
      src: templates[name],
      path: name,
      noCache: config.isDevelopment,
    }
  },
})

const env = new njk.Environment(new MyLoader(), {})

const moneyFormatter = new Intl.NumberFormat(`en-US`, {
  style: `currency`,
  currency: `USD`,
})
env.addFilter(`money`, function (text) {
  if (_.isString(text)) {
    text = parseInt(text, 10)
  }
  return moneyFormatter.format(text / 100)
})

// env.addFilter(`editorjs`, function (text) {
//   return editor.render(text)
// })

env.addFilter(`json`, function (value) {
  console.log(value)
  return JSON.stringify(value)
})

env.addFilter(`encodeURI`, function (value) {
  console.log(value)
  return encodeURI(value)
})

export default env
