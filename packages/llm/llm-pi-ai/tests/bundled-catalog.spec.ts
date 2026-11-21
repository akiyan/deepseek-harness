/**
 * Bundled-catalog behavior: a route pi-ai does not ship still resolves its
 * endpoint, capacities, and reasoning levels from the data this build carries,
 * while every configured field keeps winning over it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '../src/config.ts'
import { BUNDLED_PROVIDERS, bundledModel, bundledProvider } from '../src/bundled-catalog.ts'
import { assemble } from './assemble.ts'
import { memoryAuth } from './auth-double.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const KEY_ENV = 'PI_TEST_KEY'

beforeEach(() => {
  vi.stubEnv(KEY_ENV, 'test-key')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

/** A context with the runtime mounted, for `listModels`/`resolveModelInfo` reads. */
async function harness(profiles: LlmPiAi.Options): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, profiles)
  return ctx
}

describe('bundled catalog', () => {
  it('describes a route pi-ai does not ship, with its own endpoint and protocol', () => {
    const resolved = resolveProfiles({ 'ollama-cloud': { apiKeyEnv: KEY_ENV } }).get('ollama-cloud')!

    expect(resolved.catalogError).toBeUndefined()
    expect(resolved.modelErrors.size).toBe(0)
    expect(resolved.api).toBe('openai-responses')
    expect(resolved.baseURL).toBe('https://ollama.com/v1')
    expect(resolved.piProvider?.id).toBe('ollama-cloud')
  })

  it('serves the bundled models with their real capacities instead of the route defaults', async () => {
    const ctx = await harness({ providers: { 'ollama-cloud': { apiKeyEnv: KEY_ENV } } })
    const models = await ctx.llm.listModels('ollama-cloud')

    expect(models.map(model => model.id)).toContain('deepseek-v4.1-flash:1017')
    expect(models.map(model => model.id)).toContain('kimi-k3')
  })

  it('serves the pinned 1017 build under DeepSeek\'s own name and no untagged entry', async () => {
    const ctx = await harness({ providers: { 'ollama-cloud': { apiKeyEnv: KEY_ENV } } })
    const info = await ctx.llm.resolveModelInfo('ollama-cloud', 'deepseek-v4.1-flash:1017')

    expect(info.name).toBe('DeepSeek-V4.1-Flash')
    expect(info.context?.contextWindow).toBe(1_048_576)
    expect(info.inputModalities).toEqual(['text', 'image'])
    expect(info.reasoning?.efforts.map(effort => effort.id)).toContain('off')

    const resolved = resolveProfiles({ 'ollama-cloud': { apiKeyEnv: KEY_ENV } }).get('ollama-cloud')!
    const model = resolved.piProvider?.getModels().find(entry => entry.id === 'deepseek-v4.1-flash:1017')
    expect(model?.maxTokens).toBe(393_216)
    // The pinned tag is the route's Flash entry: a deployment goes through one
    // selectable model rather than two names for the same weights.
    expect((await ctx.llm.listModels('ollama-cloud')).map(entry => entry.id))
      .not.toContain('deepseek-v4.1-flash')
  })

  it('reports the model context window rather than the 262,144 route default', async () => {
    const ctx = await harness({ providers: { 'ollama-cloud': { apiKeyEnv: KEY_ENV } } })
    const info = await ctx.llm.resolveModelInfo('ollama-cloud', 'deepseek-v4.1-flash:1017')

    expect(info.context?.contextWindow).toBe(1_048_576)
    expect(info.inputModalities).toEqual(['text', 'image'])
  })

  it('carries the model output maximum the endpoint accepts', () => {
    const resolved = resolveProfiles({ 'ollama-cloud': { apiKeyEnv: KEY_ENV } }).get('ollama-cloud')!
    const model = resolved.piProvider?.getModels().find(entry => entry.id === 'deepseek-v4.1-flash:1017')

    expect(model?.maxTokens).toBe(393_216)
  })

  it('offers reasoning levels for a reasoning model', async () => {
    const ctx = await harness({ providers: { 'ollama-cloud': { apiKeyEnv: KEY_ENV } } })
    const info = await ctx.llm.resolveModelInfo('ollama-cloud', 'deepseek-v4.1-flash:1017')

    expect(info.reasoning?.efforts.map(effort => effort.id)).toEqual([
      'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
    ])
  })

  it('withholds the off level from a model whose endpoint keeps thinking', async () => {
    const ctx = await harness({ providers: { 'ollama-cloud': { apiKeyEnv: KEY_ENV } } })
    const info = await ctx.llm.resolveModelInfo('ollama-cloud', 'gpt-oss:20b')

    expect(info.reasoning?.efforts.map(effort => effort.id)).not.toContain('off')
    expect(info.reasoning?.efforts.map(effort => effort.id)).toContain('high')
  })

  it('omits thinking levels for a bundled entry that does not reason', () => {
    const bundle = bundledProvider('ollama-cloud')!
    const descriptor = bundledModel('ollama-cloud', bundle, {
      id: 'plain-completion', name: 'Plain Completion', contextWindow: 8_192, maxTokens: 1_024,
      input: ['text'] as const,
    })

    expect(descriptor.reasoning).toBe(false)
    expect(descriptor.thinkingLevelMap).toBeUndefined()
  })

  it('lets configuration correct a bundled capacity', async () => {
    const ctx = await harness({
      providers: {
        'ollama-cloud': {
          apiKeyEnv: KEY_ENV,
          models: [{ id: 'deepseek-v4.1-flash:1017', contextWindow: 131_072 }],
        },
      },
    })
    const info = await ctx.llm.resolveModelInfo('ollama-cloud', 'deepseek-v4.1-flash:1017')

    expect(info.context?.contextWindow).toBe(131_072)
  })

  it('lets configuration repoint the route at another endpoint and protocol', () => {
    const resolved = resolveProfiles({
      'ollama-cloud': { apiKeyEnv: KEY_ENV, baseURL: 'https://proxy.example/v1', api: 'openai-completions' },
    }).get('ollama-cloud')!

    expect(resolved.api).toBe('openai-completions')
    expect(resolved.baseURL).toBe('https://proxy.example/v1')
    expect(resolved.piProvider?.getModels()[0]?.baseUrl).toBe('https://proxy.example/v1')
  })

  it('resolves a model the bundle does not name from the route defaults', () => {
    const resolved = resolveProfiles({
      'ollama-cloud': { apiKeyEnv: KEY_ENV, models: [{ id: 'not-in-the-bundle' }] },
    }).get('ollama-cloud')!

    expect(resolved.modelErrors.size).toBe(0)
    expect(resolved.piProvider?.getModels().map(model => model.id)).toEqual(['not-in-the-bundle'])
  })

  it('offers every bundled route in the configurable directory', async () => {
    const ctx = await harness({})
    const offered = ctx.llm.listConfigurableProviders()

    for (const bundle of BUNDLED_PROVIDERS) {
      expect(offered).toContainEqual({
        provider: bundle.id,
        displayName: bundle.id,
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', bundle.id],
        declared: false,
      })
    }
  })

  it('lists a dormant bundled route by its key and names it once a profile resolves it', async () => {
    // The directory keeps listing route keys, which is what a provider picker
    // renders; the resolved route is what a configured row and the model
    // picker name.
    const dormant = await harness({})
    expect(dormant.llm.listConfigurableProviders().find(entry => entry.provider === 'ollama-cloud')?.displayName)
      .toBe('ollama-cloud')

    const configured = await harness({ providers: { 'ollama-cloud': { apiKeyEnv: KEY_ENV } } })
    expect(configured.llm.listProviders()).toContainEqual({ id: 'ollama-cloud', name: 'Ollama Cloud' })
  })

  it('lets a profile rename a bundled route', async () => {
    const ctx = await harness({ providers: { 'ollama-cloud': { displayName: 'Local Ollama' } } })

    expect(ctx.llm.listProviders()).toContainEqual({ id: 'ollama-cloud', name: 'Local Ollama' })
  })

  it('places a bundled route where its name reads rather than after every installed one', async () => {
    const ctx = await harness({})
    const offered = ctx.llm.listConfigurableProviders().map(entry => entry.provider)

    // The merged directory is what a provider picker renders, so a bundled
    // route belongs in name order among the installed ones instead of
    // trailing the list.
    expect(offered).toEqual([...offered].sort())
    expect(offered.indexOf('ollama-cloud')).toBeGreaterThan(-1)
  })

  it('carries the endpoint and protocol a bundled model resolves from', () => {
    const bundle = bundledProvider('ollama-cloud')!
    expect(bundle.api).toBe('openai-responses')
    for (const model of bundle.models) {
      // A ceiling the endpoint rejects a larger value against, and a window the
      // model is actually served at — either one missing would silently fall
      // back to the adapter's generic defaults.
      expect(model.maxTokens).toBeGreaterThan(0)
      expect(model.contextWindow).toBeGreaterThanOrEqual(model.maxTokens)
    }
  })

  it('serves the models the service published after the first snapshot', async () => {
    const ctx = await harness({ providers: { 'ollama-cloud': { apiKeyEnv: KEY_ENV } } })
    const listed = await ctx.llm.listModels('ollama-cloud')
    expect(listed.map(model => model.id)).toEqual(expect.arrayContaining([
      'inkling-2-small',
      'kimi-k3.1-pro',
      'mimo-v2.6-flash',
      'mimo-v2.6-pro',
    ]))
    // The service retired these models; the bundle follows its current listing.
    for (const retired of ['minimax-m2.7', 'mistral-large-3:675b', 'nemotron-3-nano:30b']) {
      expect(listed.map(model => model.id)).not.toContain(retired)
    }
    const inkling = await ctx.llm.resolveModelInfo('ollama-cloud', 'inkling-2-small')
    expect(inkling.context?.contextWindow).toBe(1_048_576)
    expect(inkling.inputModalities).toEqual(['text', 'image'])
    expect(inkling.reasoning?.efforts.map(effort => effort.id)).toContain('off')
    // Each carries the capacity and modalities its endpoint reports, so the
    // picker, compaction, and image admission plan against real values.
    const mimo = await ctx.llm.resolveModelInfo('ollama-cloud', 'mimo-v2.6-flash')
    expect(mimo.context?.contextWindow).toBe(1_048_576)
    expect(mimo.inputModalities).toEqual(['text', 'image'])
    expect(mimo.reasoning?.efforts.map(effort => effort.id)).toContain('off')

    const resolved = resolveProfiles({ 'ollama-cloud': { apiKeyEnv: KEY_ENV } }).get('ollama-cloud')!
    const models = resolved.piProvider?.getModels() ?? []
    // The endpoint rejects a larger max_tokens outright and names this ceiling.
    expect(models.find(entry => entry.id === 'mimo-v2.6-pro')?.maxTokens).toBe(131_072)
    expect(models.find(entry => entry.id === 'kimi-k3.1-pro')?.maxTokens).toBe(1_048_576)
  })

  it('sends a bundled model to the route endpoint under its own protocol', async () => {
    const server = await mockServer([{ status: 401, body: JSON.stringify({ error: { message: 'expected mock failure' } }) }])
    const adapter = new LlmPiAi.PiAiAdapter({
      profiles: () => resolveProfiles({
        'ollama-cloud': { apiKeyEnv: KEY_ENV, baseURL: `${server.url}/v1` },
      }),
      resolveApiKey: () => Promise.resolve('test-key'),
      auth: memoryAuth(),
    })
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['ollama-cloud'], adapter)

    const result = await assemble(ctx, {
      provider: 'ollama-cloud',
      model: 'deepseek-v4.1-flash:1017',
      messages: [],
    })

    // A bundled route carries data rather than a protocol implementation, so
    // this proves the adapter's own construction served the request: the
    // Responses path is what the bundle names, and the profile's own endpoint
    // is what it reached.
    expect(result.finish.kind).toBe('error')
    expect(server.paths).toEqual(['/v1/responses'])
  })
})

describe('bundled Sakura AI Engine route', () => {
  const SAKURA = 'sakura-ai-engine'

  /** Send one user turn to a mock Chat Completions endpoint and return the request body. */
  async function sentBody(model: string, reasoningEffort?: string): Promise<Record<string, unknown>> {
    const server = await mockServer([{ events: textEvents }])
    const adapter = new LlmPiAi.PiAiAdapter({
      profiles: () => resolveProfiles({ [SAKURA]: { apiKeyEnv: KEY_ENV, baseURL: `${server.url}/v1` } }),
      resolveApiKey: () => Promise.resolve('test-key'),
      auth: memoryAuth(),
    })
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter([SAKURA], adapter)
    const result = await assemble(ctx, {
      provider: SAKURA,
      model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'model', provider: SAKURA, model },
      })],
      ...reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) },
      maxTokens: 1024,
    })
    expect(result.finish.kind).toBe('stop')
    expect(server.paths).toEqual(['/v1/chat/completions'])
    return server.requests[0] as Record<string, unknown>
  }

  it('resolves a profile that names only a credential to the service endpoint', async () => {
    const resolved = resolveProfiles({ [SAKURA]: { apiKeyEnv: KEY_ENV } }).get(SAKURA)!

    expect(resolved.catalogError).toBeUndefined()
    expect(resolved.modelErrors.size).toBe(0)
    expect(resolved.api).toBe('openai-completions')
    expect(resolved.baseURL).toBe('https://api.ai.sakura.ad.jp/v1')
    const ctx = await harness({ providers: { [SAKURA]: { apiKeyEnv: KEY_ENV } } })
    expect(ctx.llm.listProviders()).toContainEqual({ id: SAKURA, name: 'Sakura AI Engine' })
  })

  it('lists only the models that accept tools, with their published capacities', async () => {
    const ctx = await harness({ providers: { [SAKURA]: { apiKeyEnv: KEY_ENV } } })
    const listed = (await ctx.llm.listModels(SAKURA)).map(model => model.id)

    expect(listed).toEqual(expect.arrayContaining([
      'gpt-oss-120b',
      'preview/DeepSeek-V4.1-Flash-1017',
      'preview/GLM-5.3-Flash',
      'preview/Kimi-K2.7-Code',
      'preview/Qwen3.6-35B-A3B',
      'preview/gemma-4-31B-it',
    ]))
    // The endpoint rejects `tools` on these, and every agent request carries them.
    for (const toolless of ['llm-jp-3.1-8x13b-instruct4', 'preview/Qwen3-VL-30B-A3B-Instruct', 'preview/Qwen3-0.6B-cpu']) {
      expect(listed).not.toContain(toolless)
    }
    const deepseek = await ctx.llm.resolveModelInfo(SAKURA, 'preview/DeepSeek-V4.1-Flash-1017')
    expect(deepseek.context?.contextWindow).toBe(1_048_575)
    expect(deepseek.inputModalities).toEqual(['text', 'image'])
    const gptOss = await ctx.llm.resolveModelInfo(SAKURA, 'gpt-oss-120b')
    expect(gptOss.context?.contextWindow).toBe(131_072)
    expect(gptOss.inputModalities).toEqual(['text'])
    for (const model of bundledProvider(SAKURA)!.models) expect(model.maxTokens).toBe(32_000)
  })

  it('offers only the reasoning levels each model accepts', async () => {
    const ctx = await harness({ providers: { [SAKURA]: { apiKeyEnv: KEY_ENV } } })
    const efforts = async (model: string): Promise<string[] | undefined> =>
      (await ctx.llm.resolveModelInfo(SAKURA, model)).reasoning?.efforts.map(effort => effort.id)

    expect(await efforts('gpt-oss-120b')).toEqual(['low', 'medium', 'high'])
    expect(await efforts('preview/DeepSeek-V4.1-Flash-1017')).toEqual(['off', 'low', 'high', 'xhigh', 'max'])
    expect(await efforts('preview/Kimi-K2.7-Code')).toEqual(['low', 'medium', 'high'])
    expect(await efforts('preview/GLM-5.3-Flash')).toEqual(['low', 'medium', 'high'])
    expect(await efforts('preview/Qwen3.6-35B-A3B')).toEqual(['off', 'low', 'medium', 'high'])
    expect(await efforts('preview/gemma-4-31B-it')).toEqual(['off', 'low', 'medium', 'high'])
  })

  it('sends max_tokens and the selected reasoning_effort over Chat Completions', async () => {
    const body = await sentBody('preview/DeepSeek-V4.1-Flash-1017', 'xhigh')

    expect(body['model']).toBe('preview/DeepSeek-V4.1-Flash-1017')
    expect(body['max_tokens']).toBe(1024)
    expect(body).not.toHaveProperty('max_completion_tokens')
    expect(body['reasoning_effort']).toBe('xhigh')
  })

  it('sends none for off and nothing for a model that cannot stop reasoning', async () => {
    expect((await sentBody('preview/gemma-4-31B-it', 'off'))['reasoning_effort']).toBe('none')
    // gpt-oss rejects `none` with HTTP 400, so an unselected level sends no parameter.
    expect(await sentBody('gpt-oss-120b')).not.toHaveProperty('reasoning_effort')
  })
})
