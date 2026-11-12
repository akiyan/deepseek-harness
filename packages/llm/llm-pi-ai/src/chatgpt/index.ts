/** Install the OAuth-only route and its authenticated, same-origin account controls. */
import { ChatGPTError } from './error.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { z } from 'zod'
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import { ChatGPTAccounts } from './account.ts'
import { CHATGPT_PROVIDER, ChatGPTAdapter } from './adapter.ts'

interface ConnectionFence { requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined }
const action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), id: z.uuid().optional() }),
  z.object({ action: z.literal('select'), id: z.uuid() }),
  z.object({ action: z.literal('logout'), id: z.uuid() }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('complete'), url: z.string().min(1).max(3500) }),
])

/**
 * Send safe account data with caching disabled.
 * @param response - Host response.
 * @param status - HTTP status.
 * @param value - safe browser data.
 */
function reply(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

/**
 * Handle authenticated account queries and mutations.
 * @param accounts - account owner.
 * @param fence - deployment trust policy.
 * @returns authenticated HTTP handler.
 */
export function chatGPTRoute(
  accounts: ChatGPTAccounts,
  fence: ConnectionFence,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const rejected = fence.requestRejection(request)
    if (rejected !== undefined) { response.writeHead(rejected).end(); return }
    try {
      if (request.method === 'GET') { reply(response, 200, await accounts.view()); return }
      if (request.method !== 'POST') { response.writeHead(405, { allow: 'GET, POST' }).end(); return }
      if (!/^application\/json\b/iu.test(request.headers['content-type'] ?? '')) { reply(response, 415, { error: 'Expected application/json.' }); return }
      let size = 0
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
        size += bytes.length
        if (size > 4096) { reply(response, 413, { error: 'Request too large.' }); return }
        chunks.push(bytes)
      }
      const parsed = action.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (!parsed.success) { reply(response, 400, { error: 'Invalid ChatGPT account action.' }); return }
      switch (parsed.data.action) {
        case 'start': await accounts.start(parsed.data.id); break
        case 'select': await accounts.select(parsed.data.id); break
        case 'logout': await accounts.logout(parsed.data.id); break
        case 'cancel': await accounts.cancel(); break
        case 'complete': await accounts.complete(parsed.data.url); break
      }
      reply(response, 200, await accounts.view())
    } catch (error) {
      reply(response, 400, { error: error instanceof ChatGPTError ? error.message : 'ChatGPT account operation failed. Retry from Settings > Models.' })
    }
  }
}

/**
 * Register the independent OAuth route and account controls.
 * @param ctx - owning llm-pi-ai plugin context.
 */
export function registerChatGPT(ctx: Context): void {
  ctx.inject(['credentials'], (authenticated) => {
    const accounts = new ChatGPTAccounts(authenticated.credentials)
    authenticated.effect(() => () => accounts.dispose(), 'chatgpt: pending authorization')
    const adapter = new ChatGPTAdapter(accounts, {
      resolveAttachments: () => authenticated.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, path => authenticated.get('fs')?.processPathFromHostPath(path), ref),
    })
    authenticated.llm.registerAdapter([CHATGPT_PROVIDER], adapter)
    authenticated.inject(['webServer', 'connection'], (host) => {
      const fence = Reflect.get(host, 'connection') as ConnectionFence
      host.effect(() => host.webServer.register({ kind: 'exact', path: '/chatgpt/account', handler: chatGPTRoute(accounts, fence) }), 'chatgpt: account route')
      host.effect(() => host.webServer.register({ kind: 'exact', path: '/chatgpt/authorize', handler: (request, response) => {
        const rejected = fence.requestRejection(request)
        if (rejected !== undefined) { response.writeHead(rejected).end(); return }
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }).end(); return }
        try {
          response.writeHead(302, { location: accounts.authorizationUrl(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end()
        } catch { reply(response, 400, { error: 'Start ChatGPT sign-in from Settings > Models.' }) }
      } }), 'chatgpt: browser redirect')
    })
  })
}
