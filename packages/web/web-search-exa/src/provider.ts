/** Exa REST and anonymous MCP requests projected into the shared web-search result. */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

/** One immutable request's settings. */
export interface ExaOptions {
  baseURL: string
  mcpURL: string
  maxResults: number
  timeoutMs: number
  maxResponseBytes: number
  resolveApiKey(): Promise<string | undefined>
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate Exa's REST vocabulary, also returned by its advanced MCP tool.
 * @param payload - decoded upstream response.
 * @returns citeable results without fabricated excerpts.
 */
export function mapExaResponse(payload: unknown): WebSearchResult {
  if (!record(payload) || !Array.isArray(payload.results)) throw new WebError('Exa returned invalid search results', 'WEB_PROVIDER_ERROR')
  const sources: WebSearchSource[] = []
  for (const entry of payload.results) {
    if (!record(entry) || typeof entry.url !== 'string' || !URL.canParse(entry.url)) continue
    if (!['https:', 'http:'].includes(new URL(entry.url).protocol)) continue
    const snippet = Array.isArray(entry.highlights)
      ? entry.highlights.filter((value): value is string => typeof value === 'string' && value.trim() !== '').join('\n') : undefined
    sources.push({
      url: entry.url,
      ...typeof entry.title === 'string' ? { title: entry.title } : {},
      ...snippet ? { snippet } : {},
      ...typeof entry.publishedDate === 'string' ? { publishedAt: entry.publishedDate } : {},
    })
  }
  return { sources, truncated: false }
}

/** Anonymous MCP without a key; REST with a credential resolved once per operation. */
export class ExaSearchProvider implements WebSearchProvider {
  readonly id = 'exa'
  readonly title = 'Exa'
  readonly description = {
    en: 'Search with Exa. Without an API key, uses the rate-limited anonymous MCP endpoint; with a key, uses the REST API.',
    ja: 'Exaで検索します。APIキーなしでは制限付きの匿名MCP、設定済みならREST APIを使います。',
  }

  /**
   * @param options - live settings read once per search.
   * @param shutdown - plugin lifetime cancellation.
   */
  constructor(private readonly options: () => ExaOptions, private readonly shutdown?: AbortSignal) {}

  available(): boolean { return !this.shutdown?.aborted }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.options()
    const signals = [AbortSignal.timeout(options.timeoutMs), ...signal === undefined ? [] : [signal],
      ...this.shutdown === undefined ? [] : [this.shutdown]]
    const operation = AbortSignal.any(signals)
    const fetchBounded: typeof globalThis.fetch = async (input, init) => {
      operation.throwIfAborted()
      const response = await globalThis.fetch(input, {
        ...init, redirect: 'error',
        signal: init?.signal ? AbortSignal.any([operation, init.signal]) : operation,
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new WebError(response.status === 429
          ? 'Exa search is rate limited. Retry later or configure EXA_API_KEY for higher limits.'
          : `Exa search failed (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
      }
      if (response.body === null) return response
      let bytes = 0
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength
          if (bytes > options.maxResponseBytes) throw new WebError('Exa response exceeds the configured byte limit', 'WEB_PROVIDER_ERROR')
          controller.enqueue(chunk)
        },
      }))
      return new Response(body, { status: response.status, headers: response.headers })
    }
    try {
      operation.throwIfAborted()
      const key = await options.resolveApiKey()
      operation.throwIfAborted()
      const numResults = request.maxResults ?? options.maxResults
      if (key) {
        const response = await fetchBounded(`${options.baseURL.replace(/\/+$/u, '')}/search`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key },
          body: JSON.stringify({ query: request.query, type: 'auto', numResults, contents: { highlights: true } }),
        })
        return mapExaResponse(await response.json())
      }
      const client = new Client({ name: 'deepseek-harness-exa', version: '0.2.2' })
      const endpoint = new URL(options.mcpURL)
      if (!endpoint.searchParams.has('tools')) endpoint.searchParams.set('tools', 'web_search_advanced_exa')
      const transport = new StreamableHTTPClientTransport(endpoint, { fetch: fetchBounded, requestInit: { headers: { 'x-exa-source': 'deepseek-harness' } } })
      try {
        await client.connect(transport, { signal: operation })
        const result = await client.callTool({ name: 'web_search_advanced_exa', arguments: {
          query: request.query, numResults, enableHighlights: true, highlightsNumSentences: 1,
        } }, { signal: operation })
        if (result.isError) throw new WebError('Exa anonymous search failed. Retry later or configure EXA_API_KEY.', 'WEB_PROVIDER_ERROR')
        if (result.structuredContent !== undefined) return mapExaResponse(result.structuredContent)
        for (const block of result.content) {
          if (block.type === 'text') return mapExaResponse(JSON.parse(block.text))
        }
        throw new WebError('Exa returned no search results payload', 'WEB_PROVIDER_ERROR')
      } finally {
        await client.close()
      }
    } catch (error) {
      if (operation.aborted) throw new WebError('Exa search cancelled or timed out', 'WEB_ABORTED')
      if (error instanceof WebError) throw error
      throw new WebError('Exa search failed. Check the connection and Exa settings.', 'WEB_PROVIDER_ERROR')
    }
  }
}
