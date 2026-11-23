/** Exa search registration with live options and credential-store authentication. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import { ExaSearchProvider } from './provider.ts'

/** Cordis plugin name. */
export const name = 'web-search-exa'
/** Required capability registry. */
export const inject = ['web']
/** Live Exa request settings; keys are stored separately in the credential store. */
export interface Config {
  /** Default result count when a request supplies no bound (1–100). */
  maxResults: Volatile<number>
  /** REST API base; authenticated requests append /search. */
  baseURL: Volatile<string>
  /** Anonymous Streamable HTTP MCP endpoint; enables the advanced tool when tools is omitted. */
  mcpURL: Volatile<string>
  /** Total network-operation deadline in milliseconds. */
  timeoutMs: Volatile<number>
  /** Maximum decoded response bytes before terminating an upstream stream. */
  maxResponseBytes: Volatile<number>
}
/** Validated deployment options. */
export const Config = z.object({
  maxResults: z.number().step(1).min(1).max(100).default(5).volatile(),
  baseURL: z.string().default('https://api.exa.ai').volatile(),
  mcpURL: z.string().default('https://mcp.exa.ai/mcp?tools=web_search_advanced_exa').volatile(),
  timeoutMs: z.number().step(1).min(1).default(30_000).volatile(),
  maxResponseBytes: z.number().step(1).min(1).default(1_048_576).volatile(),
})
/**
 * Register Exa without changing the selected search or fetch provider.
 * @param ctx - plugin context supplying capabilities and credentials.
 * @param config - live request settings.
 */
export function apply(ctx: Context, config: Config): void {
  const shutdown = new AbortController()
  const provider = new ExaSearchProvider(() => ({
    baseURL: config.baseURL.get(), mcpURL: config.mcpURL.get(),
    maxResults: config.maxResults.get(), timeoutMs: config.timeoutMs.get(),
    maxResponseBytes: config.maxResponseBytes.get(),
    resolveApiKey: async () => {
      const ref = credentialRef('EXA_API_KEY')
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(ref))?.value
      return launchEnvironmentOf(ctx).get(ref)?.value
    },
  }), shutdown.signal)
  ctx.effect(() => {
    const unregister = ctx.web.registerSearchProvider(provider)
    return () => { shutdown.abort(); unregister() }
  }, 'web-search-exa: provider')
}
