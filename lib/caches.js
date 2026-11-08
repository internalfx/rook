
import { LRUCache } from 'lru-cache'

const dataCache = new LRUCache({
  max: 500,
  ttl: 1000 * 60 * 60 * 24,
  allowStale: true,
})

const flashCache = new LRUCache({
  max: 10000,
  ttl: 1000 * 60,
})

const get = async function (key, task) {
  const cached = dataCache.get(key)
  if (cached) {
    return cached
  }
  const result = await task()
  dataCache.set(key, result)
  return result
}

export default {
  flash: flashCache,
  get,
  clear: dataCache.clear.bind(dataCache),
}
