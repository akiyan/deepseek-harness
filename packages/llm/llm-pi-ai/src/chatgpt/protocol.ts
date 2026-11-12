/** Official Sign in with ChatGPT public-client protocol. Tokens never leave Host storage. */
import { ChatGPTError } from './error.ts'
import { createRemoteJWKSet, jwtVerify, customFetch } from 'jose'
import { z } from 'zod'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { ChatGPTTokens } from './storage.ts'

/** Trusted OpenAI identity issuer. */
export const ISSUER = 'https://auth.openai.com'
/** Public inference resource authorized by the OAuth grant. */
export const RESOURCE = 'https://api.openai.com/v1'
/** Permission required before any ChatGPT plan inference. */
export const DIRECT_SCOPE = 'chatgpt.tokens.use.direct'
/** Complete scope set for initial and returning authorization. */
export const SCOPES = `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`
/** User-owned plan and credit controls. */
export const USAGE_URL = 'https://chatgpt.com/settings/usage'
const tokenResponse = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1).optional(), id_token: z.string().min(1).optional(),
  expires_in: z.number().positive(), scope: z.string().optional(),
})
const discovery = z.object({ issuer: z.literal(ISSUER), jwks_uri: z.url(), revocation_endpoint: z.url() })

/** Network and identity dependencies, injectable for local protocol tests. */
export class ChatGPTProtocol {
  private metadata: Promise<z.infer<typeof discovery>> | undefined
  private keys: ReturnType<typeof createRemoteJWKSet> | undefined

  constructor(readonly request: typeof fetch = fetch) {}

  /**
   * Request JSON from an official OpenAI endpoint.
   * @param url - official endpoint.
   * @param init - request details.
   * @returns JSON after successful HTTP completion.
   */
  async json(url: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response
    try {
      const headers = new Headers(attributionHeaders())
      new Headers(init.headers).forEach((value, name) => { headers.set(name, value) })
      const deadline = AbortSignal.timeout(30_000)
      response = await this.request(url, {
        ...init, headers, signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
      })
    } catch (cause) {
      throw new ChatGPTError('ChatGPT connection failed; check the network and retry.', 'CHATGPT_NETWORK', { cause })
    }
    if (!response.ok) {
      // Do not echo token-endpoint bodies or authorization URLs into diagnostics.
      const body: unknown = await response.json().catch(() => undefined)
      const error = z.object({ error: z.union([z.string(), z.object({ code: z.string().optional() })]) }).safeParse(body)
      const code = error.success ? typeof error.data.error === 'string' ? error.data.error : error.data.error.code : undefined
      const safeCode = code !== undefined && /^[a-z0-9_]{1,100}$/u.test(code) ? code : 'request_failed'
      const requestId = response.headers.get('x-request-id')
      const message = `ChatGPT request failed (HTTP ${response.status}, ${safeCode})`
        + `${requestId ? `; request ID ${requestId}` : ''}. Manage usage: ${USAGE_URL}`
      throw new ChatGPTError(message, 'CHATGPT_REQUEST', {
        status: response.status, requestCode: safeCode, ...requestId === null ? {} : { requestId },
      })
    }
    return response.json()
  }

  /**
   * Resolve trusted OIDC metadata.
   * @returns issuer metadata, rejecting endpoints outside the trusted issuer.
   */
  async configuration(): Promise<z.infer<typeof discovery>> {
    this.metadata ??= this.json(`${ISSUER}/.well-known/openid-configuration`).then((value) => {
      const parsed = discovery.parse(value)
      for (const endpoint of [parsed.jwks_uri, parsed.revocation_endpoint]) {
        if (new URL(endpoint).origin !== ISSUER) throw new ChatGPTError('Unexpected ChatGPT authentication endpoint.', 'CHATGPT_IDENTITY')
      }
      return parsed
    }).catch((error: unknown) => { this.metadata = undefined; throw error })
    return this.metadata
  }

  /**
   * Exchange an OAuth grant for replacement credentials.
   * @param body - OAuth form.
   * @param previous - retained grant on refresh.
   * @param signal - request lifetime.
   * @returns replacement credentials.
   */
  async token(body: URLSearchParams, previous?: ChatGPTTokens, signal?: AbortSignal): Promise<ChatGPTTokens> {
    const parsed = tokenResponse.safeParse(await this.json(`${ISSUER}/api/accounts/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
      ...signal === undefined ? {} : { signal },
    }))
    if (!parsed.success) throw new ChatGPTError('Invalid ChatGPT token response; sign in again.', 'CHATGPT_TOKEN')
    const data = parsed.data
    const refresh = data.refresh_token ?? previous?.refresh
    const idToken = data.id_token ?? previous?.idToken
    return {
      access: data.access_token,
      ...refresh === undefined ? {} : { refresh },
      ...idToken === undefined ? {} : { idToken },
      expires: Date.now() + data.expires_in * 1000,
      scopes: data.scope === undefined ? previous?.scopes ?? [] : data.scope.split(/\s+/u).filter(Boolean),
    }
  }

  /**
   * Verify the signed identity against this login attempt.
   * @param token - issued ID token.
   * @param clientId - registration audience.
   * @param nonce - pending login nonce.
   * @returns verified identity.
   */
  async identity(token: string, clientId: string, nonce: string): Promise<{ subject: string; email?: string }> {
    const metadata = await this.configuration()
    this.keys ??= createRemoteJWKSet(new URL(metadata.jwks_uri), { [customFetch]: this.request })
    try {
      const { payload } = await jwtVerify(token, this.keys, { issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'exp', 'iat', 'nonce'] })
      if (payload.nonce !== nonce || typeof payload.sub !== 'string' || payload.sub.length === 0) throw new Error('Identity mismatch')
      return { subject: payload.sub, ...typeof payload.email === 'string' ? { email: payload.email } : {} }
    } catch (cause) {
      throw new ChatGPTError('ChatGPT identity could not be verified; start sign-in again.', 'CHATGPT_IDENTITY', { cause })
    }
  }

  /**
   * Revoke the renewable OpenAI session.
   * @param clientId - issued registration ID.
   * @param refresh - renewable session.
   * @returns after confirmed remote revocation.
   */
  async revoke(clientId: string, refresh: string): Promise<void> {
    const metadata = await this.configuration()
    const response = await this.request(metadata.revocation_endpoint, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, token: refresh, token_type_hint: 'refresh_token' }), signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new ChatGPTError('ChatGPT sign-out was not confirmed. Retry or disconnect the app in ChatGPT settings.', 'CHATGPT_REVOCATION')
  }
}
