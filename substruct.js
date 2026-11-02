import config from './configure.js'
import { importDirectory, collapse } from './lib/utils.js'
import cors from '@koa/cors'
import http from 'node:http'
import Koa from 'koa'
import ratelimit from 'koa-ratelimit'
import koaBody from 'koa-body'
import { createRouter, addRoute, findRoute } from 'rou3'

// MIDDLEWARE
import metaRouter from './middleware/metaRouter.js'
import midPerformance from './middleware/performance.js'
import midHttpError from './middleware/httpError.js'
import midSession from './middleware/session.js'
import midHelpers from './middleware/helpers.js'
import midAuth from './middleware/auth.js'

const koa = new Koa()
const ratelimitDB = new Map()
const substruct = {}

const fsRouter = createRouter({})

const httpMethods = [`GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`]

koa.proxy = config.koa.proxy

koa.use(ratelimit({
  driver: `memory`,
  db: ratelimitDB,
  duration: 60000,
  errorMessage: `Too many requests`,
  id: (ctx) => ctx.ip,
  headers: {
    remaining: `Rate-Limit-Remaining`,
    reset: `Rate-Limit-Reset`,
    total: `Rate-Limit-Total`,
  },
  max: 1000,
  disableHeader: false,
  whitelist: (ctx) => {
    // some logic that returns a boolean
  },
  blacklist: (ctx) => {
    // some logic that returns a boolean
  },
}))
koa.use(cors(config.koa.cors))

// Pages are only ever framed by AAMCRM's own tab shell, never by other sites
koa.use(async function (ctx, next) {
  ctx.set(`Content-Security-Policy`, `frame-ancestors 'self'`)
  await next()
})

koa.use(metaRouter)
koa.use(midPerformance)
// A chat message can carry a few photos as data URLs (see routes/chat/send.js), beyond the
// default 1 MB for JSON
koa.use(koaBody({ jsonLimit: `10mb`, ...config.koaBody }))
koa.use(midHttpError)
koa.use(midSession)
koa.use(midHelpers)
koa.use(midAuth)

const dataRouteList = collapse(await importDirectory(config.routesDir, /(.+)\.js$/))

for (let [path, filePath] of Object.entries(dataRouteList)) {
  path = `/${path}`.replace(/\bindex\b/g, ``)
  // NAMED WILDCARD ROUTES [*name] => **:name
  path = path.replace(/\[\*(.+?)\]/g, `**:$1`)
  // WILDCARD ROUTES [*] => **
  path = path.replace(/\[\*\]/g, `**`)
  // NAMED ROUTES [name] => :name
  path = path.replace(/\[(.+?)\]/g, `:$1`)
  // ROUTES name/ => name
  path = path.replace(/^(.+)\/$/, `$1`)

  addRoute(fsRouter, null, path, { filePath })
}

// ROUTING
// ROUTING
// ROUTING
// ROUTING
// ROUTING
koa.use(async function (ctx, next) {
  const httpMethod = ctx.method.toUpperCase()
  const matchPath = ctx.path

  const fileRoute = findRoute(fsRouter, null, matchPath)

  if (fileRoute != null) {
    const controller = await import(fileRoute.data.filePath)

    ctx.state.params = fileRoute.params

    let handler = controller[httpMethod]

    // HEAD runs the GET handler; Koa leaves the body out of the response
    if (handler == null && httpMethod === `HEAD`) {
      handler = controller.GET
    }

    // The path exists but doesn't handle this method
    if (handler == null) {
      const allowed = httpMethods.filter((method) => controller[method] != null)

      if (allowed.includes(`GET`) && !allowed.includes(`HEAD`)) {
        allowed.push(`HEAD`)
      }

      ctx.set(`Allow`, allowed.join(`, `))
      ctx.status = 405
      ctx.body = `Method Not Allowed`
      return
    }

    await handler(ctx)
  }

  await next()
})

substruct.start = async function () {
  console.log(`****************** SERVER START *****************`)
  console.log(`*  env = '${config.env}'`)
  console.log(`*  port = ${config.port}`)
  console.log(`*  host = ${config.host}`)
  console.log(`*************************************************`)

  const koaCallback = koa.callback()

  const handleRequest = async function (req, res) {
    await koaCallback(req, res)
  }

  substruct.server = http.createServer(handleRequest)

  substruct.server.listen({
    port: config.port,
    host: config.host,
  })

  substruct.status = `running`

  return substruct
}

substruct.status = `stopped`

export default substruct
