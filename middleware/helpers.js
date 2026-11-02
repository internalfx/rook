
import caches from '../services/caches.js'
import config from '../configure.js'
import nunjucks from '../services/nunjucks.js'
import indicators from '../lib/indicators.js'
import dayjs from 'dayjs'
import numeral from 'numeral'
import _ from 'lodash'

// const addLineBreaks = function (text) {
//   if (text) {
//     return text.replace(/\n/g, `<br>`)
//   } else {
//     return null
//   }
// }

// const money = function (value) {
//   if (value == null || !Number.isFinite(value)) {
//     return ``
//   }
//   return numeral(value / 100).format(`$0,000.00`)
// }

const flashStore = caches.flash

export default async function (ctx, next) {
  ctx.addFlash = function (message, type = `info`) {
    const flash = flashStore.get(ctx.state.token) ?? []
    flash.push([message, type])
    flashStore.set(ctx.state.token, flash)
  }

  ctx.getFlash = function (type) {
    const flash = flashStore.peek(ctx.state.token) || []
    flashStore.delete(ctx.state.token)
    return flash
  }

  ctx.nunjucks = function (templatePath, locals = {}) {
    // const label = `NUNJUCKS RENDER`
    // console.time(label)

    const tools = {
      encodeJSON: function (data) { return encodeURI(JSON.stringify(data)) },
      dayjs,
      numeral,
      parseFloat,
      _,
    }

    // briefingIsNew, notificationsUnseen and tasksBadge, for the nav items and the bell
    const output = nunjucks.render(
      templatePath,
      { ...locals, ...tools, ctx, config, ...indicators.readIndicators() },
    )
    // console.timeEnd(label)
    return output
  }

  ctx.queryURL = function (spec) {
    // console.log(ctx.query)
    return `${ctx.path}?${(new URLSearchParams({ ...ctx.query, ...spec })).toString()}`
  }

  ctx.paginate = function (page, pageSize, count, maxLinks = 12) {
    const totalPages = Math.ceil(count / pageSize)
    const offset = (page - 1) * pageSize
    const itemsFrom = offset + 1
    const itemsTo = Math.min(offset + pageSize, count)
    const itemsTotal = count
    const hasPrev = page > 1
    const hasNext = page < totalPages

    const pageSet = []

    for (let page = 1; page <= totalPages; page += 1) {
      pageSet.push(page)
    }

    while (pageSet.length > maxLinks - 2) {
      const pageIdx = pageSet.indexOf(page)
      const frontGap = pageSet.reduce((acc, item, idx) => {
        if (idx < pageIdx) {
          acc += 1
        }

        return acc
      }, 0)
      const backGap = pageSet.reduce((acc, item, idx) => {
        if (idx > pageIdx) {
          acc += 1
        }

        return acc
      }, 0)

      const frontBreak = Math.floor((pageIdx + 0) / 2)
      const backBreak = Math.ceil((pageIdx + pageSet.length) / 2)

      if (frontGap > backGap) {
        pageSet.splice(frontBreak, 1)
      } else {
        pageSet.splice(backBreak, 1)
      }
    }

    const pages = []

    for (let idx = 0; idx < pageSet.length; idx += 1) {
      const value = pageSet[idx]
      const isLast = idx === pageSet.length - 1

      pages.push({
        page: value,
        url: ctx.queryURL({ page: value }),
        title: value,
        current: value === page,
      })

      const nextValue = pageSet[idx + 1]

      if (nextValue - value === 2 && !isLast) {
        pages.push({
          page: value + 1,
          url: ctx.queryURL({ page: value + 1 }),
          title: value + 1,
          current: false,
        })
      } else if (nextValue - value > 2 && !isLast) {
        pages.push({
          page: null,
          url: null,
          title: `...`,
          current: false,
        })
      }
    }

    return {
      page: page,
      totalPages: totalPages,
      offset,
      itemsFrom,
      itemsTo,
      itemsTotal,
      hasPrev,
      hasNext,
      prevUrl: page > 1 ? ctx.queryURL({ page: page - 1 }) : null,
      nextUrl: page < totalPages ? ctx.queryURL({ page: page + 1 }) : null,
      pages,
    }
  }

  await next()
}
