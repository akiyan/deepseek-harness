/** Separate Harness identity with pi-ai's native OpenAI serialization and replay. */
import { ChatGPTError } from './error.ts'
import { z } from 'zod'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, PreparedAdapterCall, StreamChunk, LlmModelInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '../adapter.ts'
import type { PiAiAdapterOptions } from '../adapter.ts'
import { catalogModels } from '../catalog.ts'
import { resolveProfiles } from '../config.ts'
import { ChatGPTAccounts } from './account.ts'
import { RESOURCE } from './protocol.ts'

/** Harness route identifier, independent of the internal OpenAI transport. */
export const CHATGPT_PROVIDER = 'chatgpt'
const listing = z.object({ models: z.array(z.object({
  slug: z.string().min(1).max(200), display_name: z.string().min(1).max(200), visibility: z.string(),
})) })
const payloadObject = z.record(z.string(), z.unknown())
const UNSUPPORTED = ['background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation', 'multi_agent', 'prompt', 'prompt_cache_retention', 'prompt_cache_options', 'safety_identifier', 'temperature', 'top_logprobs', 'top_p', 'truncation', 'user', 'previous_response_id', 'service_tier']

/**
 * Apply ChatGPT plan restrictions to the Responses payload.
 * @param payload - pi-ai's final Responses body.
 * @returns body accepted by ChatGPT plan usage.
 */
export function chatGPTPayload(payload: unknown): unknown {
  const body = Object.fromEntries(Object.entries(payloadObject.parse(payload)).filter(([field]) => !UNSUPPORTED.includes(field)))
  body.store = false
  body.stream = true
  if (!Array.isArray(body.input)) throw new ChatGPTError('ChatGPT requires an array of input messages.', 'CHATGPT_PAYLOAD')
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const tools = body.tools.map((tool: unknown) => payloadObject.parse(tool))
    if (tools.some(tool => tool.type !== 'function' && tool.type !== 'custom')) throw new ChatGPTError('This tool type is unavailable with the ChatGPT plan.', 'CHATGPT_PAYLOAD')
    body.tools = [{ type: 'namespace', name: 'dsh', description: 'Tools executed by DeepSeek Harness on the user\'s machine.', tools }]
    if (typeof body.tool_choice === 'object' && body.tool_choice !== null) {
      body.tool_choice = { ...payloadObject.parse(body.tool_choice), namespace: 'dsh' }
    }
  }
  return body
}

/** OAuth-only route; no environment or API-key discovery is installed on this adapter. */
export class ChatGPTAdapter extends LlmAdapter {
  constructor(private readonly accounts: ChatGPTAccounts, private readonly options: Pick<PiAiAdapterOptions, 'resolveAttachments' | 'resolveImageAccess'> = {}) { super() }

  override providerInfo() { return { id: CHATGPT_PROVIDER, name: 'Sign in with ChatGPT' } }

  /** Freeze account, token, and account-specific catalog for one prepared call. */
  private async delegate(signal?: AbortSignal): Promise<PiAiAdapter> {
    const account = await this.accounts.credential()
    const token = account.tokens?.access
    if (token === undefined) throw new ChatGPTError('Reconnect ChatGPT in Settings > Models.', 'CHATGPT_SIGN_IN_REQUIRED')
    const result = listing.safeParse(await this.accounts.protocol.json(`${RESOURCE}/models`, { headers: { authorization: `Bearer ${token}` }, ...signal === undefined ? {} : { signal } }))
    if (!result.success) throw new ChatGPTError('ChatGPT returned an invalid model catalog; retry.', 'CHATGPT_MODELS')
    const catalog = catalogModels('openai')
    // Unknown model capabilities must be added by a pi-ai catalog update before advertising them.
    const models = result.data.models.filter(model => model.visibility === 'list' && catalog.has(model.slug)).map(model => ({ id: model.slug, name: model.display_name }))
    if (models.length === 0) throw new ChatGPTError('No ChatGPT models supported by this build are available. Refresh or update the application.', 'CHATGPT_MODELS')
    return this.createDelegate(models, async () => {
      // Recheck on dispatch: sign-out or a cross-process account change invalidates a prepared call.
      const current = await this.accounts.credential()
      if (current.id !== account.id || current.generation !== account.generation) throw new ChatGPTError('ChatGPT account changed before the request. Retry.', 'CHATGPT_ACCOUNT_CHANGED')
      return current.tokens?.access
    })
  }

  /** Build identical model capabilities for catalog metadata and authorized inference. */
  private createDelegate(models: { id: string; name: string }[], resolveApiKey: () => Promise<string | undefined>): PiAiAdapter {
    const profiles = resolveProfiles({ openai: { api: 'openai-responses', baseURL: RESOURCE, models } })
    const profile = profiles.get('openai')
    const provider = profile?.piProvider
    if (profile !== undefined && provider !== undefined) {
      profile.piProvider = { ...provider, getModels: () => provider.getModels().map(model => ({
        ...model, compat: { ...model.compat, supportsDeveloperRole: true, supportsMidConvoSystemMessages: false,
          supportsToolSearch: false, supportsAdditionalTools: false, supportsMidConvoEffort: false },
      })) }
    }
    return new PiAiAdapter({
      profiles: () => profiles,
      resolveApiKey,
      auth: {
        credentials: { read: () => Promise.resolve(undefined), list: () => Promise.resolve([]),
          modify: () => Promise.reject(new ChatGPTError('ChatGPT credentials are managed separately.', 'CHATGPT_STORAGE')),
          delete: () => Promise.resolve() },
        authContext: { env: () => Promise.resolve(undefined), fileExists: () => Promise.resolve(false) },
      },
      onPayload: chatGPTPayload,
      fetch: this.accounts.protocol.request,
      ...this.options,
    })
  }

  override async listModels(): Promise<readonly LlmModelInfo[]> {
    try {
      return (await (await this.delegate()).listModels('openai')).map(model => ({ ...model, provider: CHATGPT_PROVIDER }))
    } catch (error) {
      if (error instanceof ChatGPTError && (error.code === 'CHATGPT_SIGN_IN_REQUIRED' || error.code === 'CHATGPT_PERMISSION')) return []
      throw error
    }
  }

  override async resolveModel(_provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const descriptor = catalogModels('openai').get(model)
    if (descriptor === undefined) throw new ChatGPTError('This build does not describe the ChatGPT model. Update the application.', 'CHATGPT_MODELS')
    const delegate = this.createDelegate([{ id: model, name: descriptor.name }], () =>
      Promise.reject(new ChatGPTError('Reconnect ChatGPT in Settings > Models.', 'CHATGPT_SIGN_IN_REQUIRED')))
    return { ...await delegate.resolveModel('openai', model, signal), provider: CHATGPT_PROVIDER }
  }

  override async prepareCall(_provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const delegate = await this.delegate(signal)
    const call = await delegate.prepareCall('openai', model, signal)
    return {
      model: { ...call.model, provider: CHATGPT_PROVIDER },
      stream: options => call.stream({
        ...options, provider: 'openai',
        // Replay is validated against the assistant source before pi-ai consumes it.
        // Keep the durable source as chatgpt and translate only this request's view.
        messages: options.messages.map(message => message.role === 'assistant'
          && message.source.provider === CHATGPT_PROVIDER
          ? { ...message, source: { ...message.source, provider: 'openai' } } : message),
      }),
    }
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const call = await this.prepareCall(CHATGPT_PROVIDER, options.model, options.signal)
    yield* call.stream(options)
  }
}
