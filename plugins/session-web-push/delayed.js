export const delayOptions = Object.freeze([0, 1, 3, 5, 30, 60])
export const delayOf = value => delayOptions.includes(value) ? value : 0

// Short-lived work specific to this running Host. No notification content is stored on disk.
export function createDelayedNotifications({ schedule = setTimeout, cancel = clearTimeout, capacity = 2048 } = {}) {
  const pending = new Map()
  function drop(key, item) {
    pending.delete(key)
    cancel(item.timer)
  }
  function dropMatching(predicate) {
    for (const [key, item] of pending) if (predicate(item)) drop(key, item)
  }
  return {
    discard({ target, sessionId, category }) {
      const key = JSON.stringify([target, sessionId, category])
      const item = pending.get(key)
      if (item) drop(key, item)
    },
    enqueue({ target, sessionId, category, delayMinutes, run }) {
      const key = JSON.stringify([target, sessionId, category])
      const previous = pending.get(key)
      if (previous) drop(key, previous)
      if (pending.size >= capacity) {
        const [oldest, item] = pending.entries().next().value
        drop(oldest, item)
      }
      const item = { target, sessionId }
      item.timer = schedule(async () => {
        const current = () => pending.get(key) === item
        if (!current()) return
        try { await run(current) } finally { if (current()) pending.delete(key) }
      }, delayMinutes * 60_000)
      item.timer.unref?.()
      pending.set(key, item)
      return () => { if (pending.get(key) === item) drop(key, item) }
    },
    opened(sessionId) { dropMatching(item => item.sessionId === sessionId) },
    forget(target) { dropMatching(item => item.target === target) },
    clear() { dropMatching(() => true) },
  }
}
