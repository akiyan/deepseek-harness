import assert from 'node:assert/strict'
import test from 'node:test'
import { createPresence, shouldAutomaticallyNotify } from './presence.js'

const device = {
  origin: 'https://harness.example',
  subscription: { endpoint: 'https://push.example/sub', keys: { p256dh: 'key', auth: 'auth' } },
}

test('foreground is per browser and expires when the client disappears', () => {
  let now = 0
  const presence = createPresence(() => now)
  const other = { ...device, origin: 'https://other.example' }
  assert.equal(shouldAutomaticallyNotify(device, presence), true)
  presence.record(device, { tabId: 'tab-a', active: true, seq: 1 })
  assert.equal(shouldAutomaticallyNotify(device, presence), false)
  assert.equal(shouldAutomaticallyNotify(other, presence), true)
  now = 14_999
  assert.equal(shouldAutomaticallyNotify(device, presence), false)
  now++
  assert.equal(shouldAutomaticallyNotify(device, presence), true)
  presence.record(device, { tabId: 'tab-a', active: true, seq: 2 })
  presence.forget(device)
  assert.equal(shouldAutomaticallyNotify(device, presence), true)
})
