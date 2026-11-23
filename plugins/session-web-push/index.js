import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import webPush from 'web-push'
import { createPresence, modeOf, shouldAutomaticallyNotify } from './presence.js'
import { registerManualPush } from './manual-tool.js'
import { notificationCopy, replyPreview } from './notification-content.js'
import { createDelayedNotifications, delayOf, delayOptions } from './delayed.js'

export const inject = ['webServer', 'credentials', 'tools']
const prefix = '/session-web-push'
const recordKey = 'akiyan-session-web-push/state-v1'
const maxDevices = 32
const maxBody = 8192
const providers = new Set([
  'fcm.googleapis.com', // Chromium
  'updates.push.services.mozilla.com', // Firefox
  'web.push.apple.com', // Safari
])

function base64Key(value, length, point = false) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return false
  const bytes = Buffer.from(value, 'base64url')
  return bytes.length === length && bytes.toString('base64url') === value && (!point || bytes[0] === 4)
}

export function parseSubscription(value) {
  if (typeof value?.endpoint !== 'string' || value.endpoint.length > 4096) return undefined
  let endpoint
  try { endpoint = new URL(value.endpoint) } catch { return undefined }
  // Never let a subscription turn the Host into an arbitrary HTTP client.
  if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password || endpoint.hash
    || endpoint.pathname === '/') return undefined
  // Chrome for Testing can use Chromium's upstream FCM staging endpoint.
  const chromiumStaging = endpoint.hostname === 'jmt17.google.com' && /^\/fcm\/send\/[^/]+$/.test(endpoint.pathname)
  if (!providers.has(endpoint.hostname) && !chromiumStaging) return undefined
  const { p256dh, auth } = value.keys ?? {}
  if (!base64Key(p256dh, 65, true) || !base64Key(auth, 16)) return undefined
  return { endpoint: endpoint.href, keys: { p256dh, auth } }
}

export function sameOrigin(headers) {
  if (!headers.origin || !headers.host || (headers['sec-fetch-site'] && headers['sec-fetch-site'] !== 'same-origin')) return undefined
  try {
    const origin = new URL(headers.origin)
    if (origin.protocol === 'https:' && origin.host === headers.host.toLowerCase() && origin.origin === headers.origin) return origin.origin
  } catch { /* not an origin */ }
  return undefined
}

function topLevel(session) {
  return session?.header && !['subagent', 'workflow'].includes(session.header.origin)
    && (session.header.delegationDepth ?? 0) === 0
}

export function turnNotification(session, event) {
  if (event.type !== 'turn/end' || !topLevel(session)) return undefined
  const kind = event.data.reason.kind
  if (kind !== 'completed' && kind !== 'error') return undefined
  return { kind, tag: `dsh-session-${session.id}`, path: '/' }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  if (Number(req.headers['content-length']) > maxBody) { req.resume(); return undefined }
  const chunks = []
  let size = 0
  // Keep memory bounded; do not destroy the socket on the iterator's early exit.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > maxBody) { req.resume(); return undefined }
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return undefined }
}

function match(device, origin, subscription) {
  return device.origin === origin && device.subscription.endpoint === subscription.endpoint
    && device.subscription.keys.p256dh === subscription.keys.p256dh && device.subscription.keys.auth === subscription.keys.auth
}

function deviceId(device) {
  const { origin, subscription: { endpoint, keys } } = device
  return createHash('sha256').update(JSON.stringify([origin, endpoint, keys.p256dh, keys.auth])).digest('base64url')
}

function safeLabel(value) {
  return typeof value === 'string' ? [...value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()].slice(0, 72).join('') : ''
}

const automaticModes = ['background', 'always', 'manual']
const categoryFields = ['notifyCompletion', 'notifyActionRequired']
const defaultSessionSettings = Object.freeze({ mode: null, delayMinutes: null, notifyCompletion: null, notifyActionRequired: null })
const deviceCategories = device => Object.fromEntries(categoryFields.map(field => [field, device?.[field] !== false]))
function allowsCategory(settings, device, kind) {
  const field = kind === 'completed' ? 'notifyCompletion' : 'notifyActionRequired'
  return (settings[field] ?? device[field]) !== false
}

function isSessionId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\p{Cc}\p{Cf}]/u.test(value)
}

function sessionSettings(state, id) {
  const settings = state?.sessionSettings?.find(item => item.sessionId === id)
  return settings ? Object.fromEntries(Object.keys(defaultSessionSettings).map(field => [field, settings[field] ?? null]))
    : defaultSessionSettings
}

function deviceStatus(device) {
  return device ? {
    ...deviceCategories(device), enabled: true, mode: modeOf(device.mode), paused: device.paused === true, delayMinutes: delayOf(device.delayMinutes),
  } : { enabled: false }
}

function listDevices(state, isCurrent) {
  return { devices: (state?.devices ?? []).map(device => ({
    ...deviceCategories(device), id: deviceId(device), label: device.label || null, origin: device.origin,
    mode: modeOf(device.mode), delayMinutes: delayOf(device.delayMinutes), paused: device.paused === true, current: Boolean(isCurrent(device)),
  })) }
}

export async function apply(ctx) {
  const credentials = ctx.credentials
  const worker = await readFile(new URL('./worker.js', import.meta.url))
  const update = async change => (await credentials.modifyRecord(recordKey, async current => {
    const next = change(current?.payload)
    return next && { kind: 'grant', payload: next }
  }))?.payload
  const get = async () => (await credentials.readRecord(recordKey))?.payload
  const init = async () => (await get()) ?? await update(state => state ? undefined : {
    vapid: webPush.generateVAPIDKeys(), devices: [],
  })

  let active = true
  const presence = createPresence()
  const previews = new WeakMap()
  const turnDelays = new WeakMap()
  const delayed = createDelayedNotifications()
  const results = new WeakMap()
  const questionTimers = new Set()
  ctx.on('dispose', () => {
    active = false
    delayed.clear()
    for (const timer of questionTimers) clearTimeout(timer)
    questionTimers.clear()
  })
  async function send(state, device, notification) {
    if (!active) return 'failed'
    const { path, tag, testId } = notification
    try {
      await webPush.sendNotification(device.subscription, JSON.stringify({
        ...notificationCopy(notification, device.language), path, tag, testId,
      }), {
        vapidDetails: { ...state.vapid, subject: 'https://github.com/akiyan/deepseek-harness-ops' }, TTL: 300, timeout: 10_000,
      })
      return 'sent'
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await update(current => current && ({
          ...current, devices: current.devices.filter(item => !match(item, device.origin, device.subscription)),
        }))
        presence.forget(device)
        delayed.forget(deviceId(device))
        return 'expired'
      }
      return 'failed'
    }
  }

  registerManualPush(ctx, async ({ message }) => {
    const state = await get()
    if (!state) return { accepted: 0, total: 0 }
    const results = await Promise.all(state.devices.filter(device => device.paused !== true)
      .map(device => send(state, device, { kind: 'manual', path: '/', message })))
    return { accepted: results.filter(result => result === 'sent').length, total: results.length }
  }, ({ session, turn, delayMinutes }) => {
    turnDelays.set(session, { turn, delayMinutes })
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: `${prefix}/worker.js`, auth: 'required',
    handler(req, res, peer) {
      if (peer?.principal.kind !== 'owner') return json(res, 403, { error: 'Forbidden' })
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD')
        return json(res, 405, { error: 'Method not allowed' })
      }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' })
      res.end(req.method === 'HEAD' ? undefined : worker)
    },
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: `${prefix}/api`, auth: 'required',
    async handler(req, res, peer) {
      if (peer?.principal.kind !== 'owner') return json(res, 403, { error: 'Forbidden' })
      try {
        if (req.method === 'GET') return json(res, 200, { publicKey: (await init()).vapid.publicKey })
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'GET, POST')
          return json(res, 405, { error: 'Method not allowed' })
        }
        const origin = sameOrigin(req.headers)
        if (!origin) return json(res, 403, { error: 'An HTTPS same-origin request is required.' })
        if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
          return json(res, 415, { error: 'Expected application/json' })
        }
        const body = await readBody(req)
        const action = body?.action
        if (action === 'session-settings') {
          const { sessionId, mode, delayMinutes } = body
          if (!isSessionId(sessionId)) return json(res, 400, { error: 'Invalid session ID.' })
          if (!Object.keys(defaultSessionSettings).some(field => Object.hasOwn(body, field))) {
            return json(res, 200, sessionSettings(await get(), sessionId))
          }
          if ((mode !== null && !automaticModes.includes(mode)) || (delayMinutes !== null && !delayOptions.includes(delayMinutes))) {
            return json(res, 400, { error: 'Invalid session notification settings.' })
          }
          if (categoryFields.some(field => Object.hasOwn(body, field) && body[field] !== null && typeof body[field] !== 'boolean')) {
            return json(res, 400, { error: 'Invalid session notification categories.' })
          }
          await init()
          let atCapacity = false
          const next = await update(current => {
            const items = (current.sessionSettings ?? []).filter(item => item.sessionId !== sessionId)
            const previous = sessionSettings(current, sessionId)
            const categories = Object.fromEntries(categoryFields.map(field => [field, Object.hasOwn(body, field) ? body[field] : previous[field]]))
            if (mode !== null || delayMinutes !== null || Object.values(categories).some(value => value !== null)) {
              if (items.length >= 2048) { atCapacity = true; return undefined }
              items.push({ sessionId, mode, delayMinutes, ...categories })
            }
            return { ...current, sessionSettings: items }
          })
          if (atCapacity) return json(res, 409, { error: 'Too many saved session settings.' })
          return json(res, 200, sessionSettings(next, sessionId))
        }
        const subscription = parseSubscription(body?.subscription)
        const find = item => subscription ? match(item, origin, subscription) : false
        if (action === 'devices') return json(res, 200, listDevices(await get(), find))
        if (action === 'device') {
          const { deviceId: targetId, op } = body
          if (typeof targetId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(targetId) || !['pause', 'resume', 'remove'].includes(op)) {
            return json(res, 400, { error: 'Invalid device action.' })
          }
          let removed
          const next = await update(current => {
            const target = current?.devices.find(device => deviceId(device) === targetId)
            if (!target) return undefined
            if (op === 'remove') {
              removed = target
              return { ...current, devices: current.devices.filter(device => device !== target) }
            }
            return { ...current, devices: current.devices.map(device => device === target ? { ...device, paused: op === 'pause' } : device) }
          })
          if (removed) presence.forget(removed)
          if (op !== 'resume') delayed.forget(targetId)
          return json(res, 200, listDevices(next, find))
        }
        if (!subscription || !['subscribe', 'unsubscribe', 'status', 'test', 'mode', 'delay', 'categories', 'presence'].includes(action)) {
          return json(res, 400, { error: 'Invalid action or unsupported push subscription.' })
        }
        if (action === 'mode' && !automaticModes.includes(body.mode)) {
          return json(res, 400, { error: 'Invalid notification mode.' })
        }
        if (action === 'categories' && categoryFields.some(field => typeof body[field] !== 'boolean')) {
          return json(res, 400, { error: 'Invalid notification categories.' })
        }
        if (action === 'delay' && !delayOptions.includes(body.delayMinutes)) {
          return json(res, 400, { error: 'Invalid notification delay.' })
        }
        if (action === 'presence' && (typeof body.active !== 'boolean' || typeof body.tabId !== 'string'
          || !/^[0-9a-f-]{36}$/.test(body.tabId) || !Number.isSafeInteger(body.seq) || body.seq < 1
          || (body.sessionId != null && !isSessionId(body.sessionId)))) {
          return json(res, 400, { error: 'Invalid tab presence.' })
        }
        const state = action === 'subscribe' ? await init() : await get()
        if (!state) return json(res, 200, { enabled: false })
        if (action === 'subscribe') {
          const next = await update(current => {
            const previous = current.devices.find(find)
            const devices = current.devices.filter(item => !find(item))
            if (devices.length >= maxDevices) return undefined
            return { ...current, devices: [...devices, {
              origin, subscription, language: body.language === 'ja' ? 'ja' : 'en', mode: modeOf(previous?.mode),
              paused: previous?.paused === true, label: safeLabel(body.label) || previous?.label || '',
              delayMinutes: delayOf(previous?.delayMinutes), ...deviceCategories(previous),
            }] }
          })
          const subscribed = next.devices.find(find)
          if (!subscribed) return json(res, 409, { error: 'Too many registered browsers.' })
          return json(res, 200, deviceStatus(subscribed))
        }
        const device = state.devices.find(find)
        if (!device) return json(res, 200, { enabled: false })
        if (action === 'unsubscribe') {
          await update(current => ({ ...current, devices: current.devices.filter(item => !find(item)) }))
          presence.forget(device)
          delayed.forget(deviceId(device))
          return json(res, 200, { enabled: false })
        }
        if (action === 'status') return json(res, 200, deviceStatus(device))
        if (action === 'presence') {
          const accepted = presence.record(device, body)
          if (accepted && body.active && body.sessionId) delayed.opened(body.sessionId)
          return json(res, 200, deviceStatus(device))
        }
        if (action === 'mode' || action === 'delay' || action === 'categories') {
          const fields = action === 'mode' ? { mode: body.mode } : action === 'delay' ? { delayMinutes: body.delayMinutes }
            : deviceCategories(body)
          const next = await update(current => ({ ...current, devices: current.devices.map(item => find(item) ? { ...item, ...fields } : item) }))
          return json(res, 200, deviceStatus(next.devices.find(find)))
        }
        if (device.paused === true) return json(res, 409, { error: 'Notifications are paused for this browser.' })
        const testId = typeof body.testId === 'string' && /^[0-9a-f-]{36}$/.test(body.testId) ? body.testId : undefined
        const delivery = await send(state, device, { kind: 'test', path: '/', testId })
        if (delivery === 'failed') return json(res, 502, { error: 'The push service did not accept the test notification.' })
        return json(res, 200, { enabled: delivery === 'sent' })
      } catch {
        return json(res, 500, { error: 'Could not access push notification state.' })
      }
    },
  }))

  const logFailure = () => ctx.logger('session-web-push').warn('Could not process session notification')
  function deliverAutomatic(session, notification, { turnDelay, stillRelevant, onQueued }) {
    const sessionId = session.id
    const category = notification.kind === 'question' || notification.kind === 'approval' ? 'interaction' : 'result'
    void get().then(state => {
      if (!state || !active || !stillRelevant() || !state.devices.length) return
      const settings = sessionSettings(state, sessionId)
      const title = ctx.get?.('sessionTitle')?.get(session)?.title
      const payload = { ...notification, sessionTitle: title || `#${String(sessionId).slice(-6)}` }
      const alreadyViewed = presence.isSessionActive(sessionId)
      return Promise.all(state.devices.map(device => {
        const effective = { ...device, mode: settings.mode ?? device.mode }
        const delayMinutes = turnDelay ?? settings.delayMinutes ?? delayOf(device.delayMinutes)
        const target = deviceId(device)
        const key = { target, sessionId, category }
        delayed.discard(key)
        if (!allowsCategory(settings, device, notification.kind)) return
        if (delayMinutes === 0) {
          if (shouldAutomaticallyNotify(effective, presence)) return send(state, device, payload)
        } else if (!device.paused && effective.mode !== 'manual' && !alreadyViewed) {
          const drop = delayed.enqueue({ ...key, delayMinutes, async run(current) {
            try {
              const latest = await get()
              if (!latest || !active || !current() || !stillRelevant()) return
              const destination = latest.devices.find(item => deviceId(item) === target)
              if (!destination || presence.isSessionActive(sessionId)) return
              const settings = sessionSettings(latest, sessionId)
              if (!allowsCategory(settings, destination, notification.kind)) return
              const mode = settings.mode ?? destination.mode
              if (shouldAutomaticallyNotify({ ...destination, mode }, presence)) await send(latest, destination, payload)
            } catch { logFailure() }
          } })
          onQueued?.(drop)
        }
      }))
    }).catch(logFailure)
  }

  ctx.on('session/event', (session, event) => {
    if (!topLevel(session)) return
    if (event.type === 'turn/start') {
      results.delete(session)
      delayed.opened(session.id)
      turnDelays.delete(session)
    } else if (event.type === 'assistant/message' && event.surfaceOp === 'append' && !event.data.interrupted) {
      const content = event.data.message.content
      // Tool-call narration is not the final reply and must not replace it.
      if (!content.some(block => block.type === 'tool-call')) {
        previews.set(session, { turn: event.data.turn, ...replyPreview(content) })
      }
    } else if (event.type === 'turn/end') {
      const preview = previews.get(session)
      const override = turnDelays.get(session)
      previews.delete(session)
      turnDelays.delete(session)
      const notification = turnNotification(session, event)
      if (!notification) return
      const reply = notification.kind === 'completed' && preview?.turn === event.data.turn ? preview : undefined
      results.set(session, {
        notification: {
          ...notification, kind: reply?.question ? 'followup' : notification.kind,
          summary: reply?.summary, question: reply?.question,
        },
        turnDelay: override && override.turn === event.data.turn ? override.delayMinutes : undefined,
      })
    }
  })

  ctx.on('agent/status', ({ agent, status }) => {
    const { session } = agent
    if (!topLevel(session)) return
    if (status === 'running') {
      results.delete(session)
      delayed.opened(session.id)
      return
    }
    const result = results.get(session)
    if (status !== 'idle' || !result || result.claimed) return
    result.claimed = true
    const stillRelevant = () => {
      if (!active || results.get(session) !== result || agent.status !== 'idle') return false
      if (agent.inbox?.nextTurn.length || agent.inbox?.nextStep.length) return false
      const goal = ctx.get?.('goals')?.get(agent)
      return goal?.phase !== 'active' || goal.activation !== 'armed'
    }
    // A turn can end while the driver, goal, or descendant agents still have work.
    void Promise.resolve().then(async () => {
      if (!stillRelevant()) return
      await agent.whenIdle()
      if (!stillRelevant()) return
      await ctx.get?.('subagents')?.waitForTreeWork(agent)
      if (stillRelevant()) deliverAutomatic(session, result.notification, { turnDelay: result.turnDelay, stillRelevant })
    }).catch(logFailure)
  }, { global: true })

  async function notifyPending(request, next, kind, question) {
    const session = request.agent?.session
    if (!topLevel(session) || request.signal?.aborted) return next()
    let pending = true
    const cancellations = new Set()
    const stillRelevant = () => pending && !request.signal?.aborted
    const timer = setTimeout(() => {
      questionTimers.delete(timer)
      if (stillRelevant()) deliverAutomatic(session, {
        kind, question, path: '/', tag: `dsh-interaction-${session.id}`,
      }, { turnDelay: turnDelays.get(session)?.delayMinutes, stillRelevant, onQueued: drop => cancellations.add(drop) })
    }, 2000)
    timer.unref?.()
    questionTimers.add(timer)
    try { return await next() } finally {
      pending = false
      clearTimeout(timer)
      questionTimers.delete(timer)
      for (const drop of cancellations) drop()
    }
  }
  ctx.on('user-questions/request', (request, next) => {
    if (!request.questions.length) return next()
    const first = request.questions.find(item => ['plan-review', 'approval'].includes(item.intent?.kind)) ?? request.questions[0]
    const kind = ['plan-review', 'approval'].includes(first.intent?.kind) ? 'approval' : 'question'
    return notifyPending(request, next, kind, first.question)
  }, { global: true, prepend: true })
  ctx.on('approval/request', (request, next) => notifyPending(request, next, 'approval'), { global: true, prepend: true })

  ctx.on('agent/disposed', ({ agent }) => {
    results.delete(agent.session)
    delayed.opened(agent.id)
  }, { global: true })
}
