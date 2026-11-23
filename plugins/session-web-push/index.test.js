import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import webPush from 'web-push'
import { apply, parseSubscription, sameOrigin, turnNotification } from './index.js'

const host = 'harness.example:16384'
const origin = `https://${host}`
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test',
  keys: { p256dh: webPush.generateVAPIDKeys().publicKey, auth: Buffer.alloc(16).toString('base64url') },
}
const event = kind => ({ type: 'turn/end', data: { turn: 1, reason: { kind } } })
const session = { id: 'id', header: {} }

test('accepts the browser endpoint and rejects arbitrary outbound destinations', () => {
  assert.deepEqual(parseSubscription(subscription), subscription)
  const staging = { ...subscription, endpoint: 'https://jmt17.google.com/fcm/send/test:abc' }
  assert.deepEqual(parseSubscription(staging), staging)
  for (const endpoint of ['https://jmt17.google.com/other/test', 'https://127.0.0.1/a', 'http://fcm.googleapis.com/a', 'https://fcm.googleapis.com.evil.example/a',
    'https://fcm.googleapis.com:8443/a', 'https://name@fcm.googleapis.com/a', 'https://fcm.googleapis.com/a#b']) {
    assert.equal(parseSubscription({ ...subscription, endpoint }), undefined, endpoint)
  }
  assert.equal(parseSubscription({ ...subscription, keys: { ...subscription.keys, auth: 'aaa' } }), undefined)
})

test('mutations require an HTTPS origin matching Host, including the port', () => {
  assert.equal(sameOrigin({ host, origin, 'sec-fetch-site': 'same-origin' }), origin)
  assert.equal(sameOrigin({ host, origin }), origin)
  for (const headers of [{ host }, { host, origin: 'https://harness.example' }, { host, origin: `http://${host}` },
    { host, origin, 'sec-fetch-site': 'same-site' }]) assert.equal(sameOrigin(headers), undefined)
})

test('only completed and errored primary turns notify', () => {
  assert.equal(turnNotification(session, event('completed')).kind, 'completed')
  assert.equal(turnNotification(session, event('error')).kind, 'error')
  for (const kind of ['aborted', 'interrupted', 'forked']) assert.equal(turnNotification(session, event(kind)), undefined)
  assert.equal(turnNotification({ ...session, header: { origin: 'subagent' } }, event('completed')), undefined)
})

test('owner subscription, test push, durable event and stale device cleanup', async t => {
  const deliveries = []
  let expired = false
  t.mock.method(webPush, 'sendNotification', async (sub, payload, options) => {
    deliveries.push({ sub, payload: JSON.parse(payload), options })
    if (expired) throw Object.assign(new Error('Gone'), { statusCode: 410 })
  })
  const routes = new Map()
  const events = new Map()
  const tools = new Map()
  let record
  let goal
  let waitForChildren
  const ctx = {
    effect: callback => callback(),
    on: (name, callback) => events.set(name, [...(events.get(name) ?? []), callback]),
    tools: { register: definition => tools.set(definition.name, definition) },
    get: name => ({ sessionTitle: { get: () => ({ title: '請求書の出力' }) },
      goals: { get: () => goal }, subagents: { waitForTreeWork: () => waitForChildren } })[name],
    webServer: { register: route => routes.set(route.path, route) },
    credentials: {
      readRecord: async () => record,
      modifyRecord: async (_key, update) => (record = (await update(record)) ?? record),
    },
  }
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await apply(ctx)
  const owner = { principal: { kind: 'owner' } }
  const emit = event => { for (const callback of events.get('session/event')) callback(session, event) }
  const agent = { session, status: 'running', inbox: { nextTurn: [], nextStep: [] }, whenIdle: async () => {} }
  const shift = status => {
    agent.status = status
    for (const callback of events.get('agent/status')) callback({ agent, status })
  }
  async function request({ method = 'POST', peer = owner, headers = {}, ...body } = {}) {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ subscription, language: 'ja', ...body }))]), {
      method, headers: { host, origin, 'content-type': 'application/json', ...headers },
    })
    const res = {
      writeHead(status, headers) { Object.assign(this, { status, headers }) },
      end(body) { this.body = JSON.parse(body) },
    }
    const route = routes.get('/session-web-push/api')
    assert.equal(route.auth, 'required')
    await route.handler(req, res, peer)
    return res
  }
  assert.equal((await request({ method: 'GET', peer: null })).status, 403)
  const { publicKey } = (await request({ method: 'GET' })).body
  assert.equal(publicKey, (await request({ method: 'GET' })).body.publicKey)
  assert.deepEqual((await request({ action: 'test' })).body, { enabled: false })
  assert.equal((await request({ action: 'subscribe', headers: { origin: 'https://other.example' } })).status, 403)
  assert.deepEqual((await request({ action: 'subscribe', label: 'Chrome\u0000 / macOS' })).body, { enabled: true, mode: 'background', paused: false, delayMinutes: 0, notifyCompletion: true, notifyActionRequired: true })
  assert.equal((await request({ action: 'subscribe' })).status, 200)
  assert.equal(record.payload.devices.length, 1)
  const testId = '00000000-0000-4000-8000-000000000001'
  assert.equal((await request({ action: 'test', testId })).status, 200)
  assert.equal(deliveries[0].payload.testId, testId)
  assert.equal(deliveries[0].options.vapidDetails.publicKey, publicKey)
  assert.deepEqual(deliveries[0].sub, subscription)
  assert.equal(deliveries[0].payload.body, 'このブラウザで通知を受け取れます。')
  emit(event('completed'))
  await setImmediate()
  assert.equal(deliveries.length, 1, 'a turn can end while the agent continues')
  emit({ type: 'turn/start', data: { turn: 1 } })
  emit(event('completed'))
  shift('idle')
  await setImmediate()
  assert.equal(deliveries[1].payload.body, 'セッションの応答が完了しました。')
  expired = true
  assert.deepEqual((await request({ action: 'test' })).body, { enabled: false })
  assert.deepEqual((await request({ action: 'status' })).body, { enabled: false })
  assert.equal((await request({ action: 'subscribe' })).status, 200)
  assert.deepEqual((await request({ action: 'unsubscribe' })).body, { enabled: false })
  await setImmediate()
  assert.equal(deliveries.length, 3)

  const offsite = { ...subscription, endpoint: 'https://fcm.googleapis.com/fcm/send/another-device' }
  await request({ action: 'subscribe', label: 'Chrome / macOS' })
  await request({ action: 'subscribe', subscription: offsite, label: 'Firefox / Linux' })
  const devices = await request({ action: 'devices' })
  const [mac, linux] = devices.body.devices
  assert.equal(mac.current, true)
  assert.equal(mac.label, 'Chrome / macOS')
  assert.equal(linux.current, false)
  assert.equal(JSON.stringify(devices.body).includes('/fcm/send/'), false)
  assert.equal((await request({ action: 'devices', peer: { principal: { kind: 'guest' } } })).status, 403)
  assert.equal((await request({ action: 'devices', headers: { origin: 'https://other.example' } })).status, 403)
  assert.equal((await request({ action: 'devices', subscription: undefined })).body.devices.length, 2)

  const tab1 = '00000000-0000-4000-8000-000000000001'
  const tab2 = '00000000-0000-4000-8000-000000000002'
  async function tab(tabId, active, seq, sessionId) {
    assert.equal((await request({ action: 'presence', tabId, active, seq, sessionId })).status, 200)
  }
  async function automatic() { emit(event('completed')); shift('idle'); await setImmediate() }
  assert.equal((await request({ action: 'mode', subscription: offsite, mode: 'manual' })).body.mode, 'manual')
  await tab(tab1, true, 1)
  await tab(tab2, true, 1)
  await tab(tab1, false, 2)
  expired = false
  await automatic()
  assert.equal(deliveries.length, 3, 'another active tab still suppresses background notification')
  await tab(tab2, false, 3)
  await tab(tab2, true, 2)
  await automatic()
  assert.equal(deliveries.length, 4, 'out-of-order active reports do not suppress an inactive browser')
  assert.deepEqual(deliveries[3].sub, subscription)
  await tab(tab1, true, 3)
  assert.equal((await request({ action: 'mode', mode: 'always' })).body.mode, 'always')
  await automatic()
  assert.equal(deliveries.length, 5, 'always delivers even with an active tab')

  const mutation = await request({ action: 'device', op: 'pause', deviceId: mac.id, subscription: undefined })
  assert.equal(mutation.body.devices[0].paused, true)
  assert.equal((await request({ action: 'test' })).status, 409)
  await automatic()
  assert.equal(deliveries.length, 5, 'pause and manual-only both skip automatic delivery')
  emit({ type: 'turn/start' })
  emit({ type: 'user/message', surfaceOp: 'append', data: { source: { kind: 'user' } } })
  assert.deepEqual(await tools.get('send_web_push_notification').execute({ message: '確認をお願いします。' }, {
    agent: { session }, signal: new AbortController().signal,
  }), { accepted: 1, total: 1 })
  assert.deepEqual(deliveries[5].sub, offsite)
  assert.equal(deliveries[5].payload.body, '確認をお願いします。')
  assert.equal((await request({ action: 'device', op: 'resume', deviceId: mac.id })).body.devices[0].paused, false)
  assert.deepEqual((await request({ action: 'device', op: 'remove', deviceId: linux.id })).body.devices.map(device => device.id), [mac.id])
  assert.equal((await request({ action: 'status', subscription: offsite })).body.enabled, false)

  const assistant = (...content) => emit({
    type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, message: { content } },
  })
  assistant({ type: 'text', text: 'PDF出力の不具合を修正しました。再発防止のテストも追加しました。' })
  await automatic()
  assert.equal(deliveries.at(-1).payload.title, '請求書の出力')
  assert.match(deliveries.at(-1).payload.body, /PDF出力の不具合を修正しました/)
  assistant({ type: 'text', text: '準備ができました。PDFとCSVのどちらにしますか？' })
  await automatic()
  assert.equal(deliveries.at(-1).payload.title, '[要回答] 請求書の出力')
  assert.match(deliveries.at(-1).payload.body, /PDFとCSVのどちらにしますか/)

  const before = deliveries.length
  goal = { phase: 'active', activation: 'armed' }
  await automatic()
  assert.equal(deliveries.length, before, 'a momentary idle between goal rounds is not completion')
  goal = { phase: 'complete', activation: 'disarmed' }
  shift('running')
  let finishChildren
  waitForChildren = new Promise(resolve => { finishChildren = resolve })
  await automatic()
  assert.equal(deliveries.length, before, 'a stopped root must still wait for its descendants')
  finishChildren()
  await setImmediate()
  assert.equal(deliveries.length, before + 1)

  const count = deliveries.length
  const settings = { action: 'session-settings', sessionId: session.id }
  const delay = { action: 'delay', delayMinutes: 1 }
  assert.equal((await request(delay)).body.delayMinutes, 1)
  assert.equal((await request({ ...delay, delayMinutes: 2 })).status, 400)
  assert.deepEqual((await request(settings)).body, { mode: null, delayMinutes: null, notifyCompletion: null, notifyActionRequired: null })
  assert.equal((await request({ ...settings, mode: 'always', delayMinutes: 3 })).body.delayMinutes, 3)
  await automatic()
  t.mock.timers.tick(60_000)
  await setImmediate()
  assert.equal(deliveries.length, count, 'session-specific delay overrides the browser default')
  await tab(tab1, true, 4, session.id)
  await tab(tab1, false, 5, null)
  t.mock.timers.tick(180_000)
  await setImmediate()
  assert.equal(deliveries.length, count, 'even a brief foreground visit cancels the pending result')

  await automatic()
  await tab(tab1, true, 6, 'different-session')
  await tab(tab1, false, 7, null)
  t.mock.timers.tick(180_000)
  await setImmediate()
  assert.equal(deliveries.length, count + 1, 'opening a different session does not cancel this notification')

  emit({ type: 'turn/start', data: { turn: 1 } })
  emit({ type: 'user/message', surfaceOp: 'append', data: { source: { kind: 'user' } } })
  await tools.get('set_web_push_notification_delay').execute({ delayMinutes: 0 }, {
    agent: { session }, signal: new AbortController().signal,
  })
  await automatic()
  assert.equal(deliveries.length, count + 2, 'a turn-specific immediate setting overrides the session delay')
  await automatic()
  assert.equal(deliveries.length, count + 2, 'the turn override does not leak')
  assert.equal((await request({ ...settings, mode: 'manual', delayMinutes: null })).body.mode, 'manual')
  t.mock.timers.tick(180_000)
  await setImmediate()
  assert.equal(deliveries.length, count + 2, 'latest mode can suppress a pending send')
  assert.deepEqual((await request({ ...settings, mode: null, delayMinutes: null })).body, { mode: null, delayMinutes: null, notifyCompletion: null, notifyActionRequired: null })
  await automatic()
  t.mock.timers.tick(60_000)
  await setImmediate()
  assert.equal(deliveries.length, count + 3, 'inheriting restores the browser delay')
  await automatic()
  shift('running')
  t.mock.timers.tick(60_000)
  await setImmediate()
  assert.equal(deliveries.length, count + 3, 'renewed work cancels the delayed notice')

  shift('idle')
  await request({ action: 'delay', delayMinutes: 0 })
  const categories = { action: 'categories', notifyCompletion: false, notifyActionRequired: true }
  assert.equal((await request(categories)).body.notifyCompletion, false)
  const beforeCategories = deliveries.length
  await automatic()
  assert.equal(deliveries.length, beforeCategories, 'completion can be disabled independently')
  assistant({ type: 'text', text: 'PDFかCSVのどちらにしますか？' })
  await automatic()
  assert.equal(deliveries.at(-1).payload.title, '[要回答] 請求書の出力')
  emit(event('error'))
  shift('idle')
  await setImmediate()
  assert.equal(deliveries.at(-1).payload.title, '[エラー] 請求書の出力')
  const [observeApproval] = events.get('approval/request')
  const beforeApproval = deliveries.length
  assert.equal(await observeApproval({ agent }, async () => 'allowed-once'), 'allowed-once')
  t.mock.timers.tick(3000)
  await setImmediate()
  assert.equal(deliveries.length, beforeApproval, 'already answered approval is not sent')
  let approved
  const approval = observeApproval({ agent }, () => new Promise(resolve => { approved = resolve }))
  t.mock.timers.tick(2000)
  await setImmediate()
  assert.equal(deliveries.at(-1).payload.title, '[承認待ち] 請求書の出力')
  approved('allowed-once')
  await approval
  const [observeQuestion] = events.get('user-questions/request')
  const pendingQuestion = () => observeQuestion({ agent, questions: [{ question: 'どの形式で出力しますか？' }] },
    () => new Promise(resolve => { resolveQuestion = resolve }))
  let resolveQuestion
  const unanswered = pendingQuestion()
  t.mock.timers.tick(2000)
  await setImmediate()
  assert.equal(deliveries.at(-1).payload.title, '[要回答] 請求書の出力')
  resolveQuestion({ answers: [] })
  await unanswered
  const beforeMuted = deliveries.length
  await request({ action: 'delay', delayMinutes: 1 })
  const resolvedBeforeDelay = pendingQuestion()
  t.mock.timers.tick(2000)
  await setImmediate()
  resolveQuestion({ answers: [] })
  await resolvedBeforeDelay
  t.mock.timers.tick(60_000)
  await setImmediate()
  assert.equal(deliveries.length, beforeMuted, 'answering in the delay window cancels the pending notification')
  await request({ action: 'delay', delayMinutes: 0 })
  await request({ ...settings, mode: null, delayMinutes: null, notifyCompletion: true, notifyActionRequired: false })
  let answered
  const question = observeQuestion({ agent, questions: [{ question: 'PDFですか？' }] }, () => new Promise(resolve => { answered = resolve }))
  t.mock.timers.tick(2000)
  await setImmediate()
  assert.equal(deliveries.length, beforeMuted, 'session can opt out of required-action notifications')
  answered({ answers: [] })
  await question
  await automatic()
  assert.equal(deliveries.length, beforeMuted + 1, 'session can opt in to completion independently')

})
