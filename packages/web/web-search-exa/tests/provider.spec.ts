/** Keyed REST, anonymous MCP, result projection, and cancellation without external traffic. */
import { afterEach, expect, it, vi } from 'vitest'
import { ExaSearchProvider, mapExaResponse } from '../src/provider.ts'
import type { ExaOptions } from '../src/provider.ts'

function requestBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== 'string') throw new Error('Expected a JSON request body')
  const value: unknown = JSON.parse(body)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a request object')
  return value as Record<string, unknown>
}

const results = { results: [{ url: 'https://example.test/article', title: 'Article', highlights: ['A cited excerpt'], publishedDate: '2026-11-13' }] }
function options(extra: Partial<ExaOptions> = {}): ExaOptions {
  return { baseURL: 'https://api.exa.test', mcpURL: 'https://mcp.exa.test/mcp', maxResults: 5,
    timeoutMs: 1000, maxResponseBytes: 65536, resolveApiKey: async () => 'test-exa-key', ...extra }
}
afterEach(() => { vi.unstubAllGlobals() })

it('sends one credential snapshot to REST and projects highlights without full page content', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(results))
  vi.stubGlobal('fetch', fetch)
  const provider = new ExaSearchProvider(() => options())
  expect(await provider.search({ query: 'test query', maxResults: 1 })).toEqual({ sources: [
    { url: 'https://example.test/article', title: 'Article', snippet: 'A cited excerpt', publishedAt: '2026-11-13' },
  ], truncated: false })
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, init] = fetch.mock.calls[0] ?? []
  expect(url).toBe('https://api.exa.test/search')
  expect(init).toMatchObject({ redirect: 'error', headers: { 'x-api-key': 'test-exa-key' } })
  expect(requestBody(init?.body)).toMatchObject({ query: 'test query', numResults: 1, contents: { highlights: true } })
})

it.each(['json', 'sse'])('uses the MCP SDK to decode anonymous %s results without a credential', async (format) => {
  const calls: Record<string, unknown>[] = []
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'GET') return new Response(null, { status: 405 })
    expect(new Headers(init?.headers).has('x-api-key')).toBe(false)
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
    const message = requestBody(init?.body)
    calls.push(message)
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 })
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'exa-test', version: '1' } }
      : { content: [{ type: 'text', text: JSON.stringify(results) }] }
    const envelope = { jsonrpc: '2.0', id: message.id, result }
    return format === 'json' ? Response.json(envelope)
      : new Response(`event: message\ndata: ${JSON.stringify(envelope)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  })
  vi.stubGlobal('fetch', fetch)
  const provider = new ExaSearchProvider(() => options({ resolveApiKey: async () => undefined }))
  expect((await provider.search({ query: 'anonymous' })).sources).toHaveLength(1)
  expect(calls.find(call => call.method === 'tools/call')).toMatchObject({ params: {
    name: 'web_search_advanced_exa', arguments: { query: 'anonymous', numResults: 5, enableHighlights: true, highlightsNumSentences: 1 },
  } })
})

it.each([401, 429, 500])('does not retry or downgrade a configured key on HTTP %s', async (status) => {
  const fetch = vi.fn(async () => new Response('upstream private detail', { status }))
  vi.stubGlobal('fetch', fetch)
  await expect(new ExaSearchProvider(() => options()).search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('rejects oversized and malformed responses', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(results)))
  await expect(new ExaSearchProvider(() => options({ maxResponseBytes: 2 })).search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not json')))
  await expect(new ExaSearchProvider(() => options()).search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
})

it('does not dispatch an already-cancelled search or a disposed provider', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const shutdown = new AbortController()
  const provider = new ExaSearchProvider(() => options(), shutdown.signal)
  shutdown.abort()
  expect(provider.available()).toBe(false)
  await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  expect(fetch).not.toHaveBeenCalled()
})

it('does not invent snippets or expose URLs using unsupported protocols', () => {
  expect(mapExaResponse({ results: [{ url: 'javascript:alert(1)' }, { url: 'https://example.test' }, {}] }))
    .toEqual({ sources: [{ url: 'https://example.test' }], truncated: false })
  expect(() => mapExaResponse({})).toThrow()
})

it('propagates cancellation to an in-flight HTTP request', async () => {
  const started = Promise.withResolvers<undefined>()
  vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { reject(new Error('Request aborted')) }, { once: true })
    started.resolve(undefined)
  })))
  const controller = new AbortController()
  const result = new ExaSearchProvider(() => options()).search({ query: 'q' }, controller.signal)
  const rejected = expect(result).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  await started.promise
  controller.abort()
  await rejected
})
