/** Real protected storage and loopback callbacks with only OpenAI traffic replaced. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { ChatGPTAccounts } from '../src/chatgpt/account.ts'
import { ChatGPTProtocol, DIRECT_SCOPE, RESOURCE } from '../src/chatgpt/protocol.ts'
import { catalogModels } from '../src/catalog.ts'
import { ChatGPTAdapter, chatGPTPayload } from '../src/chatgpt/adapter.ts'
import { loadDocument, updateDocument, CHATGPT_KEY } from '../src/chatgpt/storage.ts'
import { chatGPTRoute } from '../src/chatgpt/index.ts'
import { createServer } from 'node:http'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { LlmRuntime, createUserMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { assemble } from './assemble.ts'
import * as plugin from '../src/index.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  vi.unstubAllEnvs()
})

function urlOf(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function bodyText(body: RequestInit['body']): string {
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  throw new Error('Expected a text request body')
}

/** Stand-in identity verifier; signature verification is exercised separately below. */
class Protocol extends ChatGPTProtocol {
  override async identity(_token: string, _client: string, _nonce: string) { return { subject: 'user-1', email: 'user@example.test' } }
}

async function fixture(request: typeof fetch = async () => Response.json({ access_token: 'oauth-access', refresh_token: 'refresh-1', id_token: 'id-1', expires_in: 3600, scope: DIRECT_SCOPE })) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-chatgpt-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(LocalCredentialProvider, { path: join(root, 'credentials.yaml'), watch: false })
  const protocol = new Protocol(request)
  const accounts = new ChatGPTAccounts(ctx.credentials, protocol)
  cleanup.push(() => accounts.dispose())
  return { ctx, accounts, protocol }
}

/** Complete the actual local callback using the state and redirect supplied by the owner. */
async function connect(accounts: ChatGPTAccounts, id?: string, clientId = 'issued-client') {
  const url = new URL(await accounts.start(id))
  const callback = new URL(url.searchParams.get('redirect_uri')!)
  callback.searchParams.set('state', url.searchParams.get('state')!)
  callback.searchParams.set('code', 'one-use-code')
  callback.searchParams.set('client_id', clientId)
  const result = await fetch(callback)
  await result.text()
  return { result, url }
}

async function seed(ctx: Context, expires = Date.now() + 3600_000) {
  const id = randomUUID()
  await updateDocument(ctx.credentials, async (state) => {
    state.active = id
    state.accounts.push({ id, generation: randomUUID(), clientId: 'issued-client', subject: 'user-1', tokens: { access: 'oauth-access', refresh: 'refresh-1', expires, scopes: [DIRECT_SCOPE] } })
  })
  return id
}

describe('ChatGPT registration and sessions', () => {
  it.each(['URL', 'no scheme', 'query', 'question query', 'other prefix'])('completes a remote return from %s and rejects its reuse', async (format) => {
    const { accounts, protocol } = await fixture()
    const exchange = vi.spyOn(protocol, 'token')
    const authorization = new URL(await accounts.start())
    const callback = new URL(authorization.searchParams.get('redirect_uri')!)
    callback.search = new URLSearchParams({ state: authorization.searchParams.get('state')!, code: 'remote-code', client_id: 'issued-client' }).toString()
    const query = callback.search.slice(1)
    const pasted = format === 'URL' ? callback.href : format === 'no scheme' ? callback.href.slice('http://'.length)
      : format === 'query' ? query : format === 'question query' ? `?${query}` : `https://unused.example/other?${query}#fragment`
    await accounts.complete(pasted)
    expect((await accounts.view()).accounts[0]).toMatchObject({ connected: true, sharing: true })
    expect((await accounts.view()).pending).toBe(false)
    expect(exchange.mock.calls[0]![0].get('redirect_uri')).toBe(authorization.searchParams.get('redirect_uri'))
    expect(exchange.mock.calls[0]![0].get('code')).toBe('remote-code')
    await expect(accounts.complete(callback.href)).rejects.toMatchObject({ code: 'CHATGPT_CALLBACK' })
    expect(exchange).toHaveBeenCalledTimes(1)
  })

  it('rejects missing or mismatched query state without consuming sign-in', async () => {
    const { accounts, protocol } = await fixture()
    const exchange = vi.spyOn(protocol, 'token')
    const authorization = new URL(await accounts.start())
    const callback = new URL(authorization.searchParams.get('redirect_uri')!)
    callback.search = new URLSearchParams({ state: authorization.searchParams.get('state')!, code: 'remote-code', client_id: 'issued-client' }).toString()
    for (const value of [
      '', 'not a URL', 'code=remote-code', '?state=wrong&code=remote-code',
      callback.href.replace('state=', 'wrong='),
    ]) await expect(accounts.complete(value)).rejects.toMatchObject({ code: 'CHATGPT_CALLBACK' })
    expect(exchange).not.toHaveBeenCalled()
    expect((await accounts.view()).pending).toBe(true)
  })

  it('persists one host, verifies a callback, and reuses its issued registration', async () => {
    const { accounts, ctx } = await fixture()
    const first = await connect(accounts)
    expect(first.result.status).toBe(200)
    expect(first.url.searchParams.get('client_id')).toBe('dynamic_agent_client')
    expect(first.url.searchParams.get('agent_name_hint')).toBe(`DeepSeek Harness (${hostname()})`)
    const view = await accounts.view()
    expect(JSON.stringify(view)).not.toContain('oauth-access')
    expect(JSON.stringify(view)).not.toContain('refresh-1')
    const saved = (await loadDocument(ctx.credentials))!
    expect(saved.hostId).toMatch(/^urn:uuid:/u)
    expect(saved.accounts[0]?.subject).toBe('user-1')
    const second = await connect(accounts, view.active)
    expect(second.url.searchParams.get('client_id')).toBe('issued-client')
    expect(second.url.searchParams.has('agent_name_hint')).toBe(false)
    expect(second.url.searchParams.get('id_token_hint')).toBe('id-1')
    expect(second.url.searchParams.get('ext_agent_host_id')).toBe(first.url.searchParams.get('ext_agent_host_id'))
    expect((await loadDocument(ctx.credentials))!.accounts).toHaveLength(1)
  })

  it('rejects a wrong state without consuming the login', async () => {
    const { accounts } = await fixture()
    const url = new URL(await accounts.start())
    const callback = new URL(url.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', 'wrong')
    callback.searchParams.set('error', 'access_denied')
    const response = await fetch(callback)
    expect(response.status).toBe(400)
    await response.text()
    expect((await accounts.view()).pending).toBe(true)
    await accounts.cancel()
    expect((await accounts.view()).pending).toBe(false)
  })

  it('retains issued registration after failed exchange for a subsequent sign-in', async () => {
    const { accounts, ctx } = await fixture(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }))
    expect((await connect(accounts)).result.status).toBe(400)
    const state = (await loadDocument(ctx.credentials))!
    expect(state.accounts[0]?.clientId).toBe('issued-client')
    expect(state.accounts[0]?.tokens).toBeUndefined()
    const url = new URL(await accounts.start(state.accounts[0]!.id))
    expect(url.searchParams.get('client_id')).toBe('issued-client')
  })

  it('keeps a valid identity without plan permission and refuses inference', async () => {
    const { accounts } = await fixture(async () => Response.json({ access_token: 'oauth-access', id_token: 'id-1', expires_in: 3600, scope: 'openid' }))
    await connect(accounts)
    expect((await accounts.view()).accounts[0]).toMatchObject({ connected: true, sharing: false })
    await expect(accounts.credential()).rejects.toMatchObject({ code: 'CHATGPT_PERMISSION' })
    expect(await new ChatGPTAdapter(accounts).listModels()).toEqual([])
  })

  it('serializes rotating refreshes across account owners and keeps the latest token', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const request = vi.fn<typeof fetch>(async () => {
      entered.resolve(undefined)
      await release.promise
      return Response.json({ access_token: 'next-access', refresh_token: 'next-refresh', expires_in: 3600 })
    })
    const { accounts, ctx, protocol } = await fixture(request)
    await seed(ctx, 0)
    const other = new ChatGPTAccounts(ctx.credentials, protocol)
    cleanup.push(() => other.dispose())
    const first = accounts.credential()
    await entered.promise
    const second = other.credential()
    release.resolve(undefined)
    const granted = await Promise.all([first, second])
    expect(request).toHaveBeenCalledTimes(1)
    expect(granted.map(account => account.tokens?.refresh)).toEqual(['next-refresh', 'next-refresh'])
    expect(new URLSearchParams(bodyText(request.mock.calls[0]![1]!.body)).get('client_id')).toBe('issued-client')
  })

  it('clears unusable tokens but retains client and host after terminal refresh failure', async () => {
    const { accounts, ctx } = await fixture(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }))
    await seed(ctx, 0)
    await expect(accounts.credential()).rejects.toMatchObject({ code: 'CHATGPT_SIGN_IN_REQUIRED' })
    expect((await loadDocument(ctx.credentials))!.accounts[0]).toMatchObject({ clientId: 'issued-client' })
    expect((await loadDocument(ctx.credentials))!.accounts[0]?.tokens).toBeUndefined()
  })

  it('retains credentials during a temporary network failure', async () => {
    const { accounts, ctx } = await fixture(async () => { throw new Error('offline') })
    await seed(ctx, 0)
    await expect(accounts.credential()).rejects.toMatchObject({ code: 'CHATGPT_NETWORK' })
    expect((await loadDocument(ctx.credentials))!.accounts[0]?.tokens?.refresh).toBe('refresh-1')
  })

  it('does not switch to another registration after signing out the active account', async () => {
    const { accounts, ctx, protocol } = await fixture()
    vi.spyOn(protocol, 'revoke').mockResolvedValue()
    const first = await seed(ctx)
    const second = await seed(ctx)
    await accounts.logout(second)
    expect((await accounts.view()).active).toBeUndefined()
    expect((await accounts.view()).accounts.find(account => account.id === first)?.connected).toBe(true)
    await expect(accounts.credential()).rejects.toMatchObject({ code: 'CHATGPT_SIGN_IN_REQUIRED' })
  })

  it('revokes before clearing tokens and retains registration through logout', async () => {
    const { accounts, ctx, protocol } = await fixture()
    const id = await seed(ctx)
    const revoke = vi.spyOn(protocol, 'revoke').mockImplementation(async (client, refresh) => {
      expect(client).toBe('issued-client')
      expect(refresh).toBe('refresh-1')
      expect((await loadDocument(ctx.credentials))!.accounts[0]?.tokens).toBeDefined()
    })
    await accounts.logout(id)
    expect(revoke).toHaveBeenCalledTimes(1)
    expect((await accounts.view()).accounts[0]?.connected).toBe(false)
    expect((await loadDocument(ctx.credentials))!.accounts[0]?.clientId).toBe('issued-client')
  })

  it('reports unconfirmed remote revocation after completing local sign-out', async () => {
    const { accounts, ctx, protocol } = await fixture()
    const id = await seed(ctx)
    vi.spyOn(protocol, 'revoke').mockRejectedValue(new Error('offline'))
    await expect(accounts.logout(id)).rejects.toMatchObject({ code: 'CHATGPT_REVOCATION' })
    expect((await accounts.view()).accounts[0]?.connected).toBe(false)
  })

  it('keeps equal-email registrations separate and supports selection', async () => {
    const { accounts, ctx } = await fixture()
    await connect(accounts, undefined, 'client-1')
    await connect(accounts, undefined, 'client-2')
    const document = (await loadDocument(ctx.credentials))!
    expect(document.accounts).toHaveLength(2)
    await accounts.select(document.accounts[0]!.id)
    expect((await accounts.credential()).clientId).toBe('client-1')
    await expect(accounts.select(randomUUID())).rejects.toMatchObject({ code: 'CHATGPT_ACCOUNT' })
  })

  it('withdraws listeners and prevents simultaneous starts', async () => {
    const { accounts } = await fixture()
    const first = accounts.start()
    await expect(accounts.start()).rejects.toMatchObject({ code: 'CHATGPT_BUSY' })
    const url = new URL(await first)
    await accounts.dispose()
    await expect(fetch(url.searchParams.get('redirect_uri')!)).rejects.toThrow()
  })

  it('cancels an in-flight token exchange without committing tokens or reporting a login failure', async () => {
    const entered = Promise.withResolvers<undefined>()
    const { accounts, ctx } = await fixture((_input, init) => new Promise<Response>((_resolve, reject) => {
      entered.resolve(undefined)
      const signal = init?.signal
      if (signal === undefined || signal === null) throw new Error('Expected request cancellation')
      signal.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
    }))
    const url = new URL(await accounts.start())
    const callback = new URL(url.searchParams.get('redirect_uri')!)
    callback.search = new URLSearchParams({ state: url.searchParams.get('state')!, code: 'code', client_id: 'issued-client' }).toString()
    const response = fetch(callback).then(value => value.text()).catch(() => '')
    await entered.promise
    await accounts.cancel()
    await response
    expect((await loadDocument(ctx.credentials))?.accounts[0]?.tokens).toBeUndefined()
    expect((await accounts.view()).error).toBeUndefined()
  })

  it('rejects a changed registration ID or identity before replacing a saved account', async () => {
    const { accounts, ctx, protocol } = await fixture()
    await connect(accounts)
    const id = (await accounts.view()).active
    expect((await connect(accounts, id, 'different-client')).result.status).toBe(400)
    vi.spyOn(protocol, 'identity').mockResolvedValue({ subject: 'different-user', email: 'other@example.test' })
    expect((await connect(accounts, id)).result.status).toBe(400)
    const account = (await loadDocument(ctx.credentials))?.accounts[0]
    expect(account?.subject).toBe('user-1')
    expect(account?.clientId).toBe('issued-client')
  })
})

describe('ChatGPT identity verification', () => {
  it('verifies signature, issuer, audience, expiration, and nonce with issuer JWKS', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey)
    const request: typeof fetch = async input => urlOf(input).endsWith('openid-configuration')
      ? Response.json({ issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/keys', revocation_endpoint: 'https://auth.openai.com/revoke' })
      : Response.json({ keys: [{ ...jwk, kid: 'test-key' }] })
    const protocol = new ChatGPTProtocol(request)
    const sign = (nonce = 'expected', audience = 'client', expiry = '1h') => new SignJWT({ nonce, email: 'user@example.test' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer('https://auth.openai.com').setSubject('subject').setAudience(audience).setIssuedAt().setExpirationTime(expiry).sign(privateKey)
    await expect(protocol.identity(await sign(), 'client', 'expected')).resolves.toEqual({ subject: 'subject', email: 'user@example.test' })
    for (const token of [await sign('wrong'), await sign('expected', 'other'), await sign('expected', 'client', '-1h'), 'forged.token.value']) {
      await expect(protocol.identity(token, 'client', 'expected')).rejects.toMatchObject({ code: 'CHATGPT_IDENTITY' })
    }
  })
})

describe('ChatGPT payload and route isolation', () => {
  it('round-trips a namespaced tool call and persisted replay through the actual LLM adapter', async () => {
    const requests: Record<string, unknown>[] = []
    const tool = { type: 'function_call', id: 'fc_read', call_id: 'call_read', namespace: 'dsh', name: 'read', arguments: '{"path":"example.txt"}' }
    const text = { type: 'message', id: 'msg_reply', role: 'assistant', content: [{ type: 'output_text', text: 'File read.', annotations: [] }] }
    const request: typeof fetch = async (input, init) => {
      if (urlOf(input) === `${RESOURCE}/models`) return Response.json({ models: [{ slug: 'gpt-6-sol', display_name: 'Account GPT', visibility: 'list' }] })
      expect(urlOf(input)).toBe(`${RESOURCE}/responses`)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer oauth-access')
      requests.push(JSON.parse(bodyText(init?.body)) as Record<string, unknown>)
      const item = requests.length === 1 ? tool : text
      const events = [
        { type: 'response.created', response: { id: `resp_${requests.length}` } },
        { type: 'response.output_item.added', output_index: 0, item },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: `resp_${requests.length}`, status: 'completed', output: [item], usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 } } },
      ]
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
    }
    const { accounts, ctx } = await fixture(request)
    await seed(ctx)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['chatgpt'], new ChatGPTAdapter(accounts))
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Read example.txt.' }] })
    const tools = [{ name: 'read', description: 'Read a file', parameters: { type: 'object' as const, properties: { path: { type: 'string' } }, required: ['path'] } }]
    const first = await assemble(ctx, { provider: 'chatgpt', model: 'gpt-6-sol', messages: [user], tools })
    expect(first.finish).toEqual({ kind: 'tool-calls' })
    const call = first.message.content.find(block => block.type === 'tool-call')
    if (call?.type !== 'tool-call') throw new Error('Expected a tool call')
    expect(call.name).toBe('read')
    expect(JSON.parse(call.arguments)).toEqual({ path: 'example.txt' })
    const restored = JSON.parse(JSON.stringify(first.message)) as typeof first.message
    const result = createToolResultMessage({ callId: call.id, content: [{ type: 'text', text: 'file contents' }], isError: false })
    const second = await assemble(ctx, { provider: 'chatgpt', model: 'gpt-6-sol', messages: [user, restored, result], tools })
    expect(second.finish).toEqual({ kind: 'stop' })
    expect(requests[1]).not.toHaveProperty('previous_response_id')
    expect(requests[1]?.input).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'function_call', namespace: 'dsh' }), expect.objectContaining({ type: 'function_call_output' })]))
    expect(requests[0]?.tools).toEqual([expect.objectContaining({ type: 'namespace', name: 'dsh' })])
    expect(first.message.source).toMatchObject({ provider: 'chatgpt', model: 'gpt-6-sol' })
  })

  it.each(['response.failed', 'interrupted'])('does not report %s as completed inference', async (terminal) => {
    const request: typeof fetch = async (input) => {
      if (urlOf(input).endsWith('/models')) return Response.json({ models: [{ slug: 'gpt-6-sol', display_name: 'GPT', visibility: 'list' }] })
      const event = terminal === 'response.failed'
        ? { type: terminal, response: { status: 'failed', error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Usage limit reached' } } }
        : { type: 'response.created', response: { id: 'interrupted' } }
      return new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    }
    const { accounts, ctx } = await fixture(request)
    await seed(ctx)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['chatgpt'], new ChatGPTAdapter(accounts))
    const result = await assemble(ctx, { provider: 'chatgpt', model: 'gpt-6-sol', messages: [] })
    expect(result.finish.kind).toBe('error')
  })

  it('wraps local tools, omits unsupported options, and leaves the source body unchanged', () => {
    const input = { input: [], tools: [{ type: 'function', name: 'read', parameters: {} }], temperature: 1, max_output_tokens: 12, previous_response_id: 'old', store: true, stream: false }
    const body = chatGPTPayload(input)
    expect(body).toMatchObject({ store: false, stream: true, tools: [{ type: 'namespace', name: 'dsh', tools: input.tools }] })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('max_output_tokens')
    expect(body).not.toHaveProperty('previous_response_id')
    expect(input.store).toBe(true)
    expect(() => chatGPTPayload({ input: [], tools: [{ type: 'tool_search' }] })).toThrow()
  })

  it('advertises only account-visible supported models and never reads ambient API keys', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-unrelated-api-key')
    const request = vi.fn<typeof fetch>(async () => Response.json({ models: [
      { slug: 'gpt-6-sol', display_name: 'Account GPT', visibility: 'list' },
      { slug: 'gpt-6-astra', display_name: 'Hidden', visibility: 'hidden' },
      { slug: 'unknown-future-model', display_name: 'Future', visibility: 'list' },
    ] }))
    const { accounts, ctx } = await fixture(request)
    const adapter = new ChatGPTAdapter(accounts)
    expect(await adapter.listModels()).toEqual([])
    await seed(ctx)
    expect(await adapter.listModels()).toEqual([expect.objectContaining({ provider: 'chatgpt', id: 'gpt-6-sol', name: 'Account GPT' })])
    expect(new Headers(request.mock.calls[0]![1]?.headers).get('authorization')).toBe('Bearer oauth-access')
    expect(adapter.providerInfo().name).toBe('Sign in with ChatGPT')
  })

  it('resolves every listed model locally without repeating account catalog requests', async () => {
    const models = [...catalogModels('openai').values()].slice(0, 3)
    expect(models).toHaveLength(3)
    const request = vi.fn<typeof fetch>(async () => Response.json({ models: models.map(model => ({
      slug: model.id, display_name: `Account ${model.id}`, visibility: 'list',
    })) }))
    const { accounts, ctx } = await fixture(request)
    const accountId = await seed(ctx)
    await ctx.plugin(LlmRuntime)
    const adapter = new ChatGPTAdapter(accounts)
    ctx.llm.registerAdapter(['chatgpt'], adapter)
    const listed = await ctx.llm.listModels('chatgpt')
    expect(listed).toHaveLength(3)
    const resolved = await Promise.all(listed.map(model => ctx.llm.resolveModelInfo('chatgpt', model.id)))
    expect(resolved.map(model => model.id)).toEqual(models.map(model => model.id))
    expect(resolved.every(model => model.provider === 'chatgpt' && (model.context?.contextWindow ?? 0) > 0)).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
    vi.spyOn(accounts.protocol, 'revoke').mockResolvedValue(undefined)
    await accounts.logout(accountId)
    const afterLogout = request.mock.calls.length
    await adapter.resolveModel('chatgpt', models[0]!.id)
    expect(request).toHaveBeenCalledTimes(afterLogout)
    await expect(adapter.prepareCall('chatgpt', models[0]!.id)).rejects.toMatchObject({ code: 'CHATGPT_SIGN_IN_REQUIRED' })
    await expect(adapter.resolveModel('chatgpt', 'unknown-future-model')).rejects.toThrow('Update the application')
  })

  it('registers independently, leaves OpenAI OAuth disabled, and removes its route on disposal', async () => {
    const { ctx } = await fixture()
    await ctx.plugin(LlmRuntime)
    const fiber = ctx.plugin(plugin, { chatgpt: true })
    await fiber
    expect(ctx.llm.listProviders()).toEqual([{ id: 'chatgpt', name: 'Sign in with ChatGPT' }])
    expect(await ctx.llm.listModels('chatgpt')).toEqual([])
    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
    expect(await ctx.credentials.readRecord(CHATGPT_KEY)).toBeUndefined()
  })

  it('applies the connection fence before exposing account data or accepting mutations', async () => {
    const { accounts } = await fixture()
    const handler = chatGPTRoute(accounts, { requestRejection: () => 403 })
    const server = createServer((request, response) => { void handler(request, response) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    cleanup.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() }))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing listener')
    const response = await fetch(`http://127.0.0.1:${address.port}/chatgpt/account`)
    expect(response.status).toBe(403)
    expect(await response.text()).toBe('')
    expect((await accounts.view()).pending).toBe(false)
  })
})
