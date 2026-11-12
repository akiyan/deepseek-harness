/** Host-owned browser login, account selection, renewable sessions, and safe UI state. */
import { ChatGPTError } from './error.ts'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { hostname } from 'node:os'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { ChatGPTProtocol, ISSUER, RESOURCE, SCOPES, DIRECT_SCOPE } from './protocol.ts'
import { loadDocument, updateDocument } from './storage.ts'
import type { ChatGPTAccount, ChatGPTDocument } from './storage.ts'

interface Attempt {
  controller: AbortController
  server: Server
  done: Promise<void>
  url: string
}

/** Account state allowed across the browser boundary; contains no tokens. */
export interface ChatGPTView {
  active?: string
  accounts: { id: string; label: string; connected: boolean; sharing: boolean }[]
  pending: boolean
  authorizeUrl?: string
  error?: string
}

/** Owns one plugin instance's pending login; saved registrations are shared across processes. */
export class ChatGPTAccounts {
  private attempt: Attempt | undefined
  private error: string | undefined
  private closed = false

  constructor(private readonly store: CredentialProvider, readonly protocol = new ChatGPTProtocol()) {}

  /**
   * Read display-only account state.
   * @returns display-only connection state.
   */
  async view(): Promise<ChatGPTView> {
    const state = await loadDocument(this.store)
    return {
      ...state?.active === undefined ? {} : { active: state.active },
      accounts: state?.accounts.map((account, index) => ({
        id: account.id, label: `${account.email ?? 'ChatGPT'} (${index + 1})`,
        connected: account.tokens !== undefined, sharing: account.tokens?.scopes.includes(DIRECT_SCOPE) === true,
      })) ?? [],
      pending: this.attempt !== undefined,
      ...this.attempt === undefined ? {} : { authorizeUrl: '/chatgpt/authorize' },
      ...this.error === undefined ? {} : { error: this.error },
    }
  }

  /**
   * Resolve the pending browser authorization target.
   * @returns the pending OpenAI URL for a Host-owned redirect, never JSON state.
   */
  authorizationUrl(): string {
    if (!this.attempt?.url) throw new ChatGPTError('Start ChatGPT sign-in from Settings > Models.', 'CHATGPT_SIGN_IN_REQUIRED')
    return this.attempt.url
  }

  /**
   * Deliver a browser's unreachable loopback return to this Host's pending listener.
   * @param value - callback URL or query copied from the remote browser.
   * @returns after the existing callback handler verifies and consumes the result.
   */
  async complete(value: string): Promise<void> {
    const pending = this.attempt
    if (!pending?.url) throw new ChatGPTError('Start ChatGPT sign-in again before submitting its return URL.', 'CHATGPT_CALLBACK')
    const authorization = new URL(pending.url)
    const redirect = authorization.searchParams.get('redirect_uri')
    if (redirect === null) throw new ChatGPTError('Start ChatGPT sign-in again.', 'CHATGPT_CALLBACK')
    const target = new URL(redirect)
    const pasted = value.trim().split('#', 1)[0] ?? ''
    const query = new URLSearchParams(pasted.slice(pasted.indexOf('?') + 1))
    if (query.get('state') !== authorization.searchParams.get('state')) {
      throw new ChatGPTError(
        'This return does not match the pending ChatGPT sign-in. Paste the latest browser return URL or query.', 'CHATGPT_CALLBACK',
      )
    }
    // The destination comes from our listener; pasted host and path are ignored.
    target.search = query.toString()
    let response: Response
    try {
      response = await fetch(target, { redirect: 'error', signal: AbortSignal.any([pending.controller.signal, AbortSignal.timeout(60_000)]) })
      await response.arrayBuffer()
    } catch {
      throw new ChatGPTError('ChatGPT sign-in could not finish. Check the connection and start sign-in again.', 'CHATGPT_CALLBACK')
    }
    if (!response.ok) throw new ChatGPTError(this.error ?? 'ChatGPT sign-in could not finish. Start sign-in again.', 'CHATGPT_CALLBACK')
    await pending.done
  }

  /**
   * Select one saved account registration.
   * @param id - saved registration.
   * @returns after switching the active account.
   */
  async select(id: string): Promise<void> {
    await updateDocument(this.store, (state) => {
      if (!state.accounts.some(account => account.id === id)) throw new ChatGPTError('Unknown ChatGPT account.', 'CHATGPT_ACCOUNT')
      state.active = id
    })
  }

  /**
   * Prepare a loopback callback and a browser authorization request.
   * @param id - optional saved registration; omission creates a separate account.
   * @returns browser authorization URL.
   */
  async start(id?: string): Promise<string> {
    if (this.closed || this.attempt !== undefined) throw new ChatGPTError('A ChatGPT sign-in is already running; cancel it before retrying.', 'CHATGPT_BUSY')
    // Reserve this operation before the first await; concurrent HTTP starts cannot bind two listeners.
    const controller = new AbortController()
    const server = createServer()
    let finish!: () => void
    const done = new Promise<void>((resolve) => { finish = resolve })
    const attempt: Attempt = { controller, server, done, url: '' }
    this.attempt = attempt
    this.error = undefined
    try {
      const state = await updateDocument(this.store, () => {})
      controller.signal.throwIfAborted()
      const saved = id === undefined ? undefined : state.accounts.find(account => account.id === id)
      if (id !== undefined && saved === undefined) throw new ChatGPTError('Unknown ChatGPT account.', 'CHATGPT_ACCOUNT')
      const accountId = saved?.id ?? randomUUID()
      const generation = randomUUID()
      const pendingState = randomBytes(32).toString('base64url')
      const nonce = randomBytes(32).toString('base64url')
      const verifier = randomBytes(32).toString('base64url')
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      let handling = false
      let running = Promise.resolve()
      const close = (): void => { server.closeAllConnections(); server.close(() => { finish() }) }
      controller.signal.addEventListener('abort', () => { void running.finally(close) }, { once: true })
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
      })
      const address = server.address()
      if (address === null || typeof address === 'string') throw new ChatGPTError('Cannot open the ChatGPT callback listener.', 'CHATGPT_CALLBACK')
      const redirect = `http://127.0.0.1:${address.port}/auth/callback`
      const params = new URLSearchParams({
        client_id: saved?.clientId ?? 'dynamic_agent_client', ext_agent_host_id: state.hostId,
        response_type: 'code', redirect_uri: redirect, scope: SCOPES, resource: RESOURCE,
        state: pendingState, nonce, code_challenge: challenge, code_challenge_method: 'S256',
      })
      if (saved === undefined) params.set('agent_name_hint', `DeepSeek Harness (${hostname()})`)
      if (saved?.tokens?.idToken !== undefined) params.set('id_token_hint', saved.tokens.idToken)
      if (saved?.email !== undefined) params.set('login_hint', saved.email)
      attempt.url = `${ISSUER}/api/accounts/authorize?${params}`
      server.on('request', (request, response) => {
        const callback = new URL(request.url ?? '/', redirect)
        response.setHeader('cache-control', 'no-store')
        response.setHeader('content-type', 'text/plain; charset=utf-8')
        if (request.method !== 'GET' || callback.pathname !== '/auth/callback' || callback.searchParams.get('state') !== pendingState) {
          response.writeHead(400).end('Invalid ChatGPT callback. Return to DeepSeek Harness.'); return
        }
        if (handling) { response.writeHead(409).end('Sign-in is already being processed.'); return }
        handling = true
        running = (async () => {
          try {
            if (callback.searchParams.has('error')) throw new ChatGPTError('ChatGPT sign-in was declined. Start again to connect.', 'CHATGPT_DECLINED')
            const code = callback.searchParams.get('code')
            const clientId = callback.searchParams.get('client_id') ?? saved?.clientId
            if (!code || !clientId || clientId === 'dynamic_agent_client' || (saved !== undefined && clientId !== saved.clientId)) {
              throw new ChatGPTError('ChatGPT returned an invalid registration. Start sign-in again.', 'CHATGPT_CALLBACK')
            }
            controller.signal.throwIfAborted()
            // Registration can succeed before token exchange fails: retain the issued ID immediately.
            await updateDocument(this.store, (current) => {
              controller.signal.throwIfAborted()
              const entry = current.accounts.find(account => account.id === accountId)
              if (saved !== undefined && entry?.generation !== saved.generation) throw new ChatGPTError('ChatGPT account changed during sign-in; retry.', 'CHATGPT_ACCOUNT_CHANGED')
              if (entry === undefined) current.accounts.push({ id: accountId, clientId, generation })
              else entry.generation = generation
            })
            const tokens = await this.protocol.token(new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirect, resource: RESOURCE }), undefined, controller.signal)
            if (tokens.idToken === undefined) throw new ChatGPTError('ChatGPT did not return an ID token.', 'CHATGPT_IDENTITY')
            const identity = await this.protocol.identity(tokens.idToken, clientId, nonce)
            if (saved?.subject !== undefined && saved.subject !== identity.subject) throw new ChatGPTError('ChatGPT returned a different account; use Add account.', 'CHATGPT_IDENTITY')
            controller.signal.throwIfAborted()
            await updateDocument(this.store, (current) => {
              controller.signal.throwIfAborted()
              const entry = current.accounts.find(account => account.id === accountId)
              if (entry?.generation !== generation) throw new ChatGPTError('ChatGPT account changed during sign-in; retry.', 'CHATGPT_ACCOUNT_CHANGED')
              Object.assign(entry, identity, { tokens })
              current.active = accountId
            })
            response.end('ChatGPT connected. Return to DeepSeek Harness; you can close this tab.')
          } catch (error) {
            if (!controller.signal.aborted) this.error = error instanceof ChatGPTError
              ? error.message : 'ChatGPT sign-in failed. Start sign-in again.'
            if (!response.destroyed) response.writeHead(400).end('ChatGPT sign-in failed. Return to DeepSeek Harness for details.')
          } finally {
            clearTimeout(timer)
            if (this.attempt === attempt) this.attempt = undefined
            server.close(() => { finish() })
            server.closeIdleConnections()
          }
        })()
      })
      const timer = setTimeout(() => { this.error = 'ChatGPT sign-in timed out. Start sign-in again.'; void this.cancel() }, 600_000)
      done.finally(() => { clearTimeout(timer); if (this.attempt === attempt) this.attempt = undefined }).catch(() => {})
      controller.signal.throwIfAborted()
      return attempt.url
    } catch (error) {
      server.closeAllConnections()
      server.close()
      finish()
      if (this.attempt === attempt) this.attempt = undefined
      throw error
    }
  }

  /**
   * Cancel and drain the pending login.
   * @returns after the pending listener and any token exchange settle.
   */
  async cancel(): Promise<void> {
    const pending = this.attempt
    if (pending === undefined) return
    pending.controller.abort()
    pending.server.closeAllConnections()
    pending.server.close()
    await pending.done
    if (this.attempt === pending) this.attempt = undefined
  }

  /**
   * Stop pending login work before the plugin leaves.
   * @returns after all pending sign-in work has stopped.
   */
  async dispose(): Promise<void> { this.closed = true; await this.cancel() }

  /**
   * End a renewable session and clear local tokens.
   * @param id - selected registration to sign out.
   * @returns after local credentials are cleared, with remote failure reported.
   */
  async logout(id: string): Promise<void> {
    await this.cancel()
    let warning: unknown
    await updateDocument(this.store, async (state) => {
      const account = state.accounts.find(entry => entry.id === id)
      if (account === undefined) throw new ChatGPTError('Unknown ChatGPT account.', 'CHATGPT_ACCOUNT')
      if (account.tokens?.refresh !== undefined) {
        try { await this.protocol.revoke(account.clientId, account.tokens.refresh) }
        catch (error) { warning = error }
      }
      delete account.tokens
      account.generation = randomUUID()
      if (state.active === id) delete state.active
    })
    if (warning !== undefined) throw new ChatGPTError('Signed out locally. Remote revocation was not confirmed; disconnect the app in ChatGPT settings.', 'CHATGPT_REVOCATION', { cause: warning })
  }

  /**
   * Resolve the active authorized account under the refresh lock.
   * @returns the current authorized registration, refreshing under the cross-process writer lock.
   */
  async credential(): Promise<ChatGPTAccount> {
    const initial = await loadDocument(this.store)
    const selected = initial?.accounts.find(account => account.id === initial.active)
    if (selected?.tokens === undefined) throw new ChatGPTError('Continue with ChatGPT in Settings > Models to connect this provider.', 'CHATGPT_SIGN_IN_REQUIRED')
    const usable = (account: ChatGPTAccount): void => {
      if (!account.tokens?.scopes.includes(DIRECT_SCOPE)) throw new ChatGPTError('Enable ChatGPT plan usage by reconnecting this account.', 'CHATGPT_PERMISSION')
    }
    usable(selected)
    if (selected.tokens.expires > Date.now() + 180_000) return selected
    let failure: ChatGPTError | undefined
    const state = await updateDocument(this.store, async (current: ChatGPTDocument) => {
      const account = current.accounts.find(entry => entry.id === selected.id)
      if (account?.tokens === undefined || account.generation !== selected.generation) throw new ChatGPTError('ChatGPT account changed. Select it again.', 'CHATGPT_ACCOUNT_CHANGED')
      if (account.tokens.expires > Date.now() + 180_000) return
      if (account.tokens.refresh === undefined) throw new ChatGPTError('ChatGPT session expired. Reconnect this account.', 'CHATGPT_SIGN_IN_REQUIRED')
      try {
        account.tokens = await this.protocol.token(new URLSearchParams({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.tokens.refresh, resource: RESOURCE }), account.tokens)
      } catch (error) {
        if (error instanceof ChatGPTError && ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'].includes(error.requestCode ?? '')) {
          delete account.tokens
          failure = new ChatGPTError('ChatGPT session expired or was disconnected. Reconnect this account.', 'CHATGPT_SIGN_IN_REQUIRED')
        } else throw error
      }
    })
    if (failure !== undefined) throw failure
    const account = state.accounts.find(entry => entry.id === selected.id)
    if (account === undefined) throw new ChatGPTError('Unknown ChatGPT account.', 'CHATGPT_ACCOUNT')
    usable(account)
    return account
  }
}
