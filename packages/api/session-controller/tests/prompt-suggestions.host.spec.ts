/** Prompt suggestions through the Session Remote, real AgentLoop, and prepared LLM dispatch. */

import { addAbortListener } from 'node:events'
import { Buffer } from 'node:buffer'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  createUserMessage, LlmAdapter,
  type GenerateOptions, type LlmResolvedModelInfo, type ReasoningEffortId, type StreamChunk, type ToolCallId, type UserMessage,
} from '@deepseek-ai/dsh-llm'
import { SessionLogOffset, SessionSeq, type Session, type SessionId } from '@deepseek-ai/dsh-session'
import type { PeerId, PeerScope, Principal } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { expect, it, onTestFinished, vi } from 'vitest'
import { updateVolatile } from '../../../../vendor/cosmokit/src/volatile.ts'
import SessionController, { type Config } from '../src/index.ts'
import type { SessionRequestId, SessionSuggestPromptRequest } from '../src/types.ts'
import { createSessionTestController } from './test-remote.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    /** Test visitor with an expressly granted Session action. */
    'suggestion-test-visitor': { readonly kind: 'suggestion-test-visitor' }
  }
}

const NEXT = 'Could you add a test for the empty case?'
const ROUTE = { provider: 'selected', model: 'conversation-model' }
const HUMAN = 'Please update the input validation.'
const ANSWER = 'The validation now rejects invalid inputs.'
const sid = (text: string): SessionId => brandString<SessionId>(text)
const finish: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }

function response(text: string): StreamChunk[] {
  return [{ type: 'block-end', index: 0, block: { type: 'text', text } }, finish]
}

class SuggestionAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly transcript: StreamChunk[][] = []
  suggest = (_options: GenerateOptions): AsyncIterable<StreamChunk> => (async function* () { yield* response(JSON.stringify(NEXT)) })()

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const off = brandString<ReasoningEffortId>('off')
    const high = brandString<ReasoningEffortId>('high')
    return Promise.resolve({ provider, id: model, name: model, reasoning: {
      efforts: [{ id: off, name: 'Off' }, { id: high, name: 'High' }], defaultEffort: high,
    } })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield* options.purpose === 'prompt-suggestion' ? this.suggest(options) : this.transcript.shift() ?? response(ANSWER)
  }
}

async function harness(config?: Config) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(TypertRegistry)
  await mountAgentLoopTestDependencies(ctx)
  const archived: SessionId[] = []
  ctx.provide('workspaceRegistry', { get archivedSessionIds() { return archived }, list: () => [] } as never)
  const loop = await mountAgentLoopTestHarness(ctx)
  const adapter = new SuggestionAdapter()
  ctx.effect(() => ctx.llm.registerAdapter([ROUTE.provider], adapter))
  const controller = await createSessionTestController(ctx, {
    defaultModelSelection: () => ROUTE,
    cwd: '/workspace',
    ...(config === undefined ? {} : { controllerConfig: config }),
  })
  await ctx.plugin(TypertGatewayService)
  const agent = await loop.create(sid('conversation'), ROUTE, { cwd: '/workspace' })
  const suggest = (request: SessionSuggestPromptRequest, signal = new AbortController().signal) => controller.suggestPrompt(request, signal)
  const invoke = (request: SessionSuggestPromptRequest, principal: Principal = { kind: 'owner' }) => {
    const peer: PeerScope = {
      id: brandString<PeerId>('suggestion-peer'), ctx, principal, interactions: 'answer',
      signal: new AbortController().signal, dispose: () => Promise.resolve(),
    }
    return ctx.typertGateway.invoke({ namespace: 'session', method: 'suggestPrompt', peer, args: { request } })
  }
  return {
    archived, adapter, agent, ctx, invoke, suggest,
    modelSuggestions: () => adapter.requests.filter(options => options.purpose === 'prompt-suggestion'),
  }
}

const humanInput = (text = HUMAN) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

function lastTurnEnd(session: Session) {
  const end = session.snapshotEvents().findLast(event => event.type === 'turn/end')
  if (end === undefined) throw new Error('test Agent did not complete a turn')
  return end
}

async function completed(agent: Agent, input: UserMessage = humanInput()): Promise<SessionSuggestPromptRequest> {
  agent.followup(input)
  await agent.whenIdle()
  return { sessionId: agent.id, turnEndSeq: lastTurnEnd(agent.session).seq }
}

function audits(session: Session) {
  return session.snapshotEvents().filter(event => event.type === 'session/prompt-suggestion-request')
}

it('logs and flushes bounded text before dispatch, retaining only the exact marker and in-memory draft', async () => {
  const { agent, adapter, ctx, invoke, modelSuggestions } = await harness()
  const prelude = 'Intermediate narration should never be included.'
  const tool = 'tool_only_marker'
  adapter.transcript.push([
    { type: 'block-end', index: 0, block: { type: 'text', text: prelude } },
    { type: 'block-end', index: 1, block: { type: 'tool-call', id: brandString<ToolCallId>('test'), name: tool, arguments: '{}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ])
  const image = {
    attachmentId: brandString<AttachmentId>(`sha256:${'af'.repeat(32)}`),
    mediaType: 'image/png' as const, bytes: 12, width: 1, height: 1,
  }
  const flushAudits: number[] = []
  ctx.on('session/flush', (session) => { flushAudits.push(audits(session).length) })
  const request = await completed(agent, createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: HUMAN }, { type: 'image', attachment: image }],
  }))
  expect(ctx.sessionProjections.snapshot(agent.session).values.promptSuggestionTurn).toBe(request.turnEndSeq)
  expect(ctx.sessionProjections.summaryKeys().has('promptSuggestionTurn')).toBe(false)
  expect(adapter.requests.filter(value => value.purpose === undefined)).toHaveLength(2)
  // A different selection for the next user turn cannot move this model call.
  agent.model.select({ provider: 'different', model: 'other' })
  adapter.suggest = async function* () {
    expect(flushAudits.at(-1)).toBe(1)
    yield* response(JSON.stringify(NEXT))
  }
  await expect(invoke(request)).resolves.toBe(NEXT)
  await expect(invoke(request)).resolves.toBe(NEXT)
  const [sent] = modelSuggestions()
  expect(modelSuggestions()).toHaveLength(1)
  expect(sent).toMatchObject({ ...ROUTE, reasoningEffort: 'off', purpose: 'prompt-suggestion' })
  expect(sent).not.toHaveProperty('sessionId')
  expect(sent).not.toHaveProperty('tools')
  const input = JSON.stringify({ humanPrompt: HUMAN, assistantReply: ANSWER })
  expect(sent?.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: input }] }])
  expect(input).not.toContain(prelude)
  expect(input).not.toContain(tool)
  expect(input).not.toContain(image.attachmentId)
  expect(audits(agent.session)).toEqual([expect.objectContaining({
    ignorable: true,
    data: { turnEndSeq: request.turnEndSeq, route: ROUTE, system: sent?.system,
      input, maxTokens: sent?.maxTokens, reasoningEffort: sent?.reasoningEffort },
  })])
  expect(JSON.stringify(agent.session.deriveMessages())).not.toContain(NEXT)
  expect(JSON.stringify(agent.session.deriveMessages())).not.toContain(input)
})

it('resumes neither a nonexistent Session nor attached history and denies a bound non-owner', async () => {
  const { agent, ctx, invoke, suggest, modelSuggestions } = await harness()
  const request = await completed(agent)
  const visitor = { kind: 'suggestion-test-visitor' } as const
  ctx.remoteAccess.registerPolicy(visitor.kind, { bindings: () => [{
    role: { name: 'test:suggester', resource: 'session', actions: ['session/suggestPrompt'] },
    resource: { kind: 'session', id: agent.id },
  }] })
  await expect(invoke(request, visitor)).resolves.toBeNull()
  const factory = vi.spyOn(ctx.agents, 'resume')
  const cold = sid('not-active')
  await expect(suggest({ ...request, sessionId: cold })).resolves.toBeNull()
  expect(factory).not.toHaveBeenCalled()
  const childId = sid('fork-with-only-inherited-history')
  const seed = agent.session.snapshotEvents()
  const fork = await ctx.agents.create({
    sessionId: childId,
    seed,
    inheritedEventCount: SessionLogOffset(seed.length),
    meta: { cwd: '/workspace', parentSession: agent.id, isSeeded: true },
  })
  expect(ctx.sessionProjections.snapshot(fork.agent.session).values.promptSuggestionTurn).toBeNull()
  await expect(suggest({ ...request, sessionId: childId })).resolves.toBeNull()
  expect(modelSuggestions()).toEqual([])
})

it('retires superseded, queued, archived, failed, and non-human opening turns', async () => {
  const { agent, adapter, archived, ctx, suggest, modelSuggestions } = await harness()
  const marker = () => ctx.sessionProjections.snapshot(agent.session).values.promptSuggestionTurn
  const first = await completed(agent)
  await expect(suggest({ ...first, turnEndSeq: SessionSeq(first.turnEndSeq - 1) })).resolves.toBeNull()
  agent.inbox.append('next-step', humanInput('This queued text is not part of the completed turn.'))
  await expect(suggest(first)).resolves.toBeNull()
  agent.inbox.clear()
  await expect(suggest(first)).resolves.toBeNull()
  const second = await completed(agent)
  expect(marker()).toBe(second.turnEndSeq)
  await expect(suggest(first)).resolves.toBeNull()
  archived.push(agent.id)
  await expect(suggest(second)).resolves.toBeNull()
  archived.length = 0
  adapter.transcript.push([{ type: 'finish', reason: { kind: 'max-tokens' } }])
  const truncated = await completed(agent)
  expect(marker()).toBeNull()
  await expect(suggest(truncated)).resolves.toBeNull()
  await expect(suggest(second)).resolves.toBeNull()
  const automatic = await completed(agent, createUserMessage({ content: [{ type: 'text', text: 'scheduled substitute' }],
    source: { kind: 'retry', rpcId: brandString<SessionRequestId>('retry') },
  }))
  expect(marker()).toBeNull()
  await expect(suggest(automatic)).resolves.toBeNull()
  adapter.transcript.push(response('   '))
  const blank = await completed(agent)
  expect(marker()).toBeNull()
  await expect(suggest(blank)).resolves.toBeNull()
  expect(modelSuggestions()).toEqual([])
})

it('omits a suspected credential and bounds copied excerpts', async () => {
  const { agent, adapter, suggest, modelSuggestions } = await harness()
  await expect(suggest(await completed(agent, humanInput('Here is API_KEY = example-do-not-copy')))).resolves.toBeNull()
  adapter.transcript.push(response('The user supplied a password: example-do-not-copy'))
  await expect(suggest(await completed(agent))).resolves.toBeNull()
  expect(modelSuggestions()).toEqual([])
  adapter.transcript.push(response(`The task finished. ${'⌘'.repeat(9_000)} omitted-tail`))
  const next = await completed(agent, humanInput(`Please work on ${'∂'.repeat(7_000)} omitted-user-tail`))
  await expect(suggest(next)).resolves.toBe(NEXT)
  const [audit] = audits(agent.session)
  expect(audit?.data.input).not.toContain('omitted-')
  expect(Buffer.byteLength(audit?.data.input ?? '', 'utf8')).toBeLessThan(12_000)
})

it('reads the live Settings flag before preparation and again before returning a result', async () => {
  const disabled = SessionController.Config({ promptSuggestionsEnabled: false })
  const { agent, adapter, suggest, modelSuggestions } = await harness(disabled)
  const request = await completed(agent)
  await expect(suggest(request)).resolves.toBeNull()
  expect(modelSuggestions()).toEqual([])
  expect(audits(agent.session)).toEqual([])
  const enabled = SessionController.Config({ promptSuggestionsEnabled: true })
  updateVolatile(disabled.promptSuggestionsEnabled, enabled.promptSuggestionsEnabled)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  adapter.suggest = async function* () {
    entered.resolve(undefined)
    await release.promise
    yield* response(JSON.stringify(NEXT))
  }
  const thinking = suggest(request)
  await entered.promise
  updateVolatile(disabled.promptSuggestionsEnabled, SessionController.Config({ promptSuggestionsEnabled: false }).promptSuggestionsEnabled)
  release.resolve(undefined)
  await expect(thinking).resolves.toBeNull()
  expect(modelSuggestions()).toHaveLength(1)
})

it('does not dispatch after loss of eligibility at the audit checkpoint', async () => {
  const { agent, ctx, suggest, modelSuggestions } = await harness()
  const request = await completed(agent)
  const checkpoint = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  ctx.on('session/flush', async () => { checkpoint.resolve(undefined); await release.promise })
  const thinking = suggest(request)
  await checkpoint.promise
  expect(audits(agent.session)).toHaveLength(1)
  agent.inbox.append('next-turn', humanInput('A new prompt arrived before dispatch.'))
  await expect(thinking).resolves.toBeNull()
  release.resolve(undefined)
  await expect(suggest(request)).resolves.toBeNull()
  expect(modelSuggestions()).toEqual([])
})

it('does not dispatch if the audit fails to flush', async () => {
  const { agent, ctx, suggest, modelSuggestions } = await harness()
  const request = await completed(agent)
  const log = vi.spyOn(ctx.logger, 'warn')
  ctx.on('session/flush', () => Promise.reject(new Error('writer failed')))
  await expect(suggest(request)).resolves.toBeNull()
  expect(log).toHaveBeenCalledWith('session-controller: prompt suggestion could not be prepared or recorded')
  expect(modelSuggestions()).toEqual([])
})

it('keeps one shared call alive when one of its callers leaves', async () => {
  const { agent, adapter, suggest, modelSuggestions } = await harness()
  const request = await completed(agent)
  const entered = Promise.withResolvers<AbortSignal | undefined>()
  const release = Promise.withResolvers<undefined>()
  adapter.suggest = async function* (options) {
    entered.resolve(options.signal)
    await release.promise
    yield* response(JSON.stringify(NEXT))
  }
  const first = new AbortController()
  const a = suggest(request, first.signal)
  const b = suggest(request)
  const providerSignal = await entered.promise
  first.abort()
  await expect(a).resolves.toBeNull()
  expect(providerSignal?.aborted).toBe(false)
  release.resolve(undefined)
  await expect(b).resolves.toBe(NEXT)
  expect(modelSuggestions()).toHaveLength(1)
})

it('cancels shared work when all waiters leave and never dispatches the same turn twice', async () => {
  const { agent, adapter, suggest, modelSuggestions } = await harness()
  const request = await completed(agent)
  const entered = Promise.withResolvers<AbortSignal>()
  adapter.suggest = async function* ({ signal }) {
    if (signal === undefined) throw new Error('model dispatch requires an AbortSignal')
    const aborted = Promise.withResolvers<undefined>()
    using _listener = addAbortListener(signal, () => { aborted.resolve(undefined) })
    entered.resolve(signal)
    await aborted.promise
    yield* response(JSON.stringify(NEXT))
  }
  const first = new AbortController()
  const a = suggest(request, first.signal)
  const providerSignal = await entered.promise
  first.abort()
  await expect(a).resolves.toBeNull()
  expect(providerSignal.aborted).toBe(true)
  await expect(suggest(request)).resolves.toBeNull()
  expect(modelSuggestions()).toHaveLength(1)
})

it('ends loading at the configured timeout even if the adapter ignores cancellation', async () => {
  const { agent, adapter, suggest, modelSuggestions } = await harness({ promptSuggestionTimeoutMs: 175 })
  const request = await completed(agent)
  const entered = Promise.withResolvers<AbortSignal | undefined>()
  const release = Promise.withResolvers<undefined>()
  adapter.suggest = async function* ({ signal }) {
    entered.resolve(signal)
    await release.promise
    yield* response(JSON.stringify(NEXT))
  }
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const pending = suggest(request)
    const providerSignal = await entered.promise
    await vi.advanceTimersByTimeAsync(175)
    await expect(pending).resolves.toBeNull()
    expect(providerSignal?.aborted).toBe(true)
    release.resolve(undefined)
    await expect(suggest(request)).resolves.toBeNull()
    expect(modelSuggestions()).toHaveLength(1)
  } finally {
    release.resolve(undefined)
    vi.useRealTimers()
  }
})

it.each([
  ['no structured response', response(NEXT)],
  ['wrong JSON type', response(JSON.stringify({ suggestion: NEXT }))],
  ['embedded credential', response(JSON.stringify('Could you paste API_KEY = example-do-not-copy?'))],
  ['shell command', response(JSON.stringify('git status'))],
  ['slash command', response(JSON.stringify('/clear'))],
  ['credential marker', response(JSON.stringify('Could you paste the bearer secret-token-value?'))],
  ['newline', response(JSON.stringify('Add an example.\nAnd another line.'))],
  ['link', response(JSON.stringify('Please follow https://example.invalid/ there.'))],
  ['overlong text', response(JSON.stringify('a'.repeat(3_000)))],
  ['partial response without stop', response(JSON.stringify(NEXT)).slice(0, -1)],
  ['tool attempt', [{ type: 'block-start', index: 0, blockType: 'tool-call' }, ...response(JSON.stringify(NEXT))] satisfies StreamChunk[]],
  ['provider error', [{ type: 'finish', reason: { kind: 'error', failure: { message: 'failed', code: 'SERVER' } } }] satisfies StreamChunk[]],
] as const)('rejects %s instead of returning an editable draft', async (_label, chunks) => {
  const { agent, adapter, suggest } = await harness()
  adapter.suggest = async function* () { yield* chunks }
  await expect(suggest(await completed(agent))).resolves.toBeNull()
})
