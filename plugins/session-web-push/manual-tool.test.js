import assert from 'node:assert/strict'
import test from 'node:test'
import { registerManualPush } from './manual-tool.js'

function fixture({ header = {}, send = async () => ({ accepted: 1, total: 2 }), setDelay } = {}) {
  let listener
  const tools = new Map()
  const session = { header }
  const agent = { session }
  const calls = []
  registerManualPush({
    on(event, fn) {
      assert.equal(event, 'session/event')
      listener = fn
    },
    tools: { register(definition, options) { tools.set(definition.name, { tool: definition, when: options.when }) } },
  }, async args => { calls.push(args); return send(args) }, setDelay)
  const manual = tools.get('send_web_push_notification')
  const override = tools.get('set_web_push_notification_delay')
  return {
    ...manual, override, calls, agent, session,
    run: (args, signal = new AbortController().signal) => manual.tool.execute(args, { agent, signal }),
    overrideDelay: (args, signal = new AbortController().signal) => override.tool.execute(args, { agent, signal }),
    start: (turn = 1) => listener(session, { type: 'turn/start', data: { turn } }),
    end: (turn = 1) => listener(session, { type: 'turn/end', data: { turn } }),
    input: (source = { kind: 'user' }, surfaceOp = 'append') => {
      listener(session, { type: 'user/message', data: { source }, surfaceOp })
    },
  }
}

test('registers a discoverable tool and returns only push-service counts', async () => {
  const f = fixture({ send: async () => ({ accepted: 1, total: 2, endpoint: 'do not expose' }) })
  assert.equal(f.tool.name, 'send_web_push_notification')
  assert.equal(f.override, undefined)
  assert.equal(f.when({ agent: f.agent }), true)
  f.start()
  f.input()
  assert.deepEqual(await f.run({ message: '  作業完了しました。  ' }), { accepted: 1, total: 2 })
  assert.deepEqual(f.calls, [{ message: '作業完了しました。' }])
  assert.match(f.tool.output.render({}, { accepted: 1, total: 2 })[0].text, /accepted.*1 of 2/)
  assert.match(f.tool.output.render({}, { accepted: 0, total: 0 })[0].text, /No browsers/)
})

test('fails closed without live owner input and when a guest contributed to the turn', async () => {
  const f = fixture()
  const trySend = () => f.run({ message: 'Ready' })
  f.input()
  await assert.rejects(trySend, /direct owner request/)
  f.start()
  f.input({ kind: 'schedule' })
  f.input({ kind: 'user' }, { op: 'replace' })
  await assert.rejects(trySend, /direct owner request/)
  f.input()
  await trySend()
  f.input({ kind: 'user', principal: { kind: 'guest' } })
  f.input()
  await assert.rejects(trySend, /direct owner request/)
  f.end()
  await assert.rejects(trySend, /direct owner request/)
  f.start()
  await assert.rejects(trySend, /direct owner request/)
  assert.deepEqual(f.calls, [{ message: 'Ready' }])
})

test('hides the tool from delegated agents and rejects execution defensively', async () => {
  for (const header of [{ origin: 'subagent' }, { origin: 'workflow' }, { delegationDepth: 1 }]) {
    const f = fixture({ header })
    f.start()
    f.input()
    assert.equal(f.when({ agent: f.agent }), false)
    await assert.rejects(f.run({ message: 'Ready' }), /top-level session/)
    assert.deepEqual(f.calls, [])
  }
})

test('does not send malformed, oversized, secret-like or aborted messages', async () => {
  const f = fixture()
  f.start()
  f.input()
  for (const args of [null, {}, { message: 8 }, { message: ' ' }, { message: 'x', target: 'y' },
    ...['one\ntwo', 'one\u2028two', '\udc00', 'a'.repeat(241), '😀'.repeat(181), 'password: 12345',
      '-----BEGIN RSA PRIVATE KEY-----', 'Bearer xxxxxxxx'].map(message => ({ message }))]) {
    await assert.rejects(f.run(args))
  }
  await assert.rejects(f.run({ message: 'Ready' }, AbortSignal.abort()), { name: 'AbortError' })
  assert.deepEqual(f.calls, [])
})

test('sets the latest delay for the exact owner turn without sending a push', async () => {
  const byTurn = new Map()
  const f = fixture({ setDelay({ session, turn, delayMinutes }) {
    assert.equal(session, f.session)
    byTurn.set(turn, delayMinutes)
  } })
  assert.equal(f.override.when({ agent: f.agent }), true)
  assert.deepEqual(f.override.tool.parameters.properties.delayMinutes.enum, [0, 1, 3, 5, 30, 60])
  f.start(0)
  f.input()
  const result = f.overrideDelay({ delayMinutes: 30 })
  assert.equal(byTurn.get(0), 30) // The callback is synchronous.
  assert.deepEqual(await result, { delayMinutes: 30 })
  await f.overrideDelay({ delayMinutes: 0 })
  f.end(0)
  f.start(7)
  f.input()
  await f.overrideDelay({ delayMinutes: 5 })
  assert.deepEqual([...byTurn], [[0, 0], [7, 5]])
  assert.deepEqual(f.calls, [])
})

test('requires a live, identifiable top-level owner turn without guest input to override delay', async () => {
  const calls = []
  const f = fixture({ setDelay: args => calls.push(args) })
  const trySetDelay = () => f.overrideDelay({ delayMinutes: 1 })
  await assert.rejects(trySetDelay, /owner input/)
  f.start(null)
  f.input()
  await assert.rejects(trySetDelay, /owner input/)
  f.start(1)
  f.input({ kind: 'schedule' })
  await assert.rejects(trySetDelay, /owner input/)
  f.input()
  f.input({ kind: 'user', principal: { kind: 'guest' } })
  await assert.rejects(trySetDelay, /no guest input/)
  f.end(1)
  f.start(2)
  await assert.rejects(trySetDelay, /owner input/)
  f.input()
  f.end(2)
  await assert.rejects(trySetDelay, /owner input/)
  assert.deepEqual(calls, [])

  for (const header of [{ origin: 'subagent' }, { origin: 'workflow' }, { delegationDepth: 1 }]) {
    const delegated = fixture({ header, setDelay: args => calls.push(args) })
    delegated.start()
    delegated.input()
    assert.equal(delegated.override.when({ agent: delegated.agent }), false)
    await assert.rejects(delegated.overrideDelay({ delayMinutes: 1 }), /top-level session/)
  }
  assert.deepEqual(calls, [])
})

test('rejects invalid and aborted delay overrides before calling the Host', async () => {
  const calls = []
  const f = fixture({ setDelay: args => calls.push(args) })
  f.start()
  f.input()
  for (const args of [null, [], {}, { delayMinutes: 5, turn: 2 }, ...['5', -1, 1.5, 2, 60.01, null].map(delayMinutes => ({ delayMinutes }))]) {
    await assert.rejects(f.overrideDelay(args), /only delayMinutes/)
  }
  await assert.rejects(f.overrideDelay({ delayMinutes: 5 }, AbortSignal.abort()), { name: 'AbortError' })
  assert.deepEqual(calls, [])
})

test('does not leak provider errors or invalid provider results', async () => {
  for (const send of [async () => { throw new Error('sensitive endpoint') }, async () => ({ accepted: 2, total: 1 })]) {
    const f = fixture({ send })
    f.start()
    f.input()
    await assert.rejects(f.run({ message: 'Ready' }), { message: 'Web Push could not report the send result. Do not resend automatically.' })
  }
})
