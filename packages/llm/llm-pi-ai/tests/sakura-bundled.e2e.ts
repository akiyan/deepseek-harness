/**
 * Real-API verification that the bundled Sakura AI Engine route drives the
 * service as described: the Chat Completions endpoint answers, a declared
 * reasoning level is accepted, and a model whose `off` is pinned unsupported
 * is sent no rejected reasoning value. Self-skips without a credential.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'

const apiKey = process.env.SAKURA_AI_ENGINE_API_KEY
const model = process.env.DSH_PI_AI_SAKURA_MODEL ?? 'preview/DeepSeek-V4.1-Flash-1017'
const PROVIDER = 'sakura-ai-engine'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers: { [PROVIDER]: { apiKeyEnv: 'SAKURA_AI_ENGINE_API_KEY' } } })
  return ctx
}

function userTurn(text: string): ReturnType<typeof createUserMessage> {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  })
}

describe.skipIf(apiKey === undefined)('llm-pi-ai bundled Sakura AI Engine e2e', () => {
  it('streams text through Chat Completions', async () => {
    const ctx = await harness()
    const result = await assemble(ctx, {
      provider: PROVIDER,
      model,
      messages: [userTurn('Reply with exactly the word: pong')],
      maxTokens: 1024,
    })

    expect(result.finish.kind).toBe('stop')
    const text = result.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text.toLowerCase()).toContain('pong')
  })

  it('sends a reasoning level the bundle declares for the model', async () => {
    const ctx = await harness()
    const result = await assemble(ctx, {
      provider: PROVIDER,
      model,
      messages: [userTurn('What is 17*23? Answer with the number.')],
      reasoningEffort: ReasoningEffortId('max'),
      maxTokens: 2048,
    })

    expect(result.finish.kind).toBe('stop')
  })

  it('omits the reasoning value gpt-oss rejects when no level is selected', async () => {
    const ctx = await harness()
    const result = await assemble(ctx, {
      provider: PROVIDER,
      model: 'gpt-oss-120b',
      messages: [userTurn('Reply with exactly the word: pong')],
      maxTokens: 1024,
    })

    expect(result.finish.kind).toBe('stop')
  })
})
