import assert from 'node:assert/strict'
import test from 'node:test'
import { createDelayedNotifications } from './delayed.js'

test('opening the target session drops pending work for every destination, not other sessions', async () => {
  const timers = new Set()
  const queue = createDelayedNotifications({
    schedule(run, wait) {
      assert.equal(wait, 60_000)
      const timer = { run }
      timers.add(timer)
      return timer
    },
    cancel: timer => timers.delete(timer),
  })
  const sent = []
  for (const [target, sessionId] of [['desktop', 'one'], ['mobile', 'one'], ['desktop', 'two']]) {
    queue.enqueue({ target, sessionId, category: 'result', delayMinutes: 1, run: () => sent.push([target, sessionId]) })
  }
  queue.opened('one')
  for (const timer of timers) await timer.run()
  assert.deepEqual(sent, [['desktop', 'two']])
})

test('focus can still cancel while the delayed callback is awaiting subscription state', async () => {
  let callback
  const queue = createDelayedNotifications({ schedule(run) { return callback = run }, cancel() {} })
  let release
  let sent = false
  queue.enqueue({ target: 'desktop', sessionId: 'session', category: 'result', delayMinutes: 1, async run(current) {
    await new Promise(resolve => { release = resolve })
    sent = current()
  } })
  const finishing = callback()
  queue.opened('session')
  release()
  await finishing
  assert.equal(sent, false)
})
