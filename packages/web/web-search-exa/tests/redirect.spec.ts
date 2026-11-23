/** Native HTTP redirects must not forward Exa credentials or queries to another origin. */
import { createServer, type Server } from 'node:http'
import { expect, it, onTestFinished } from 'vitest'
import { ExaSearchProvider } from '../src/provider.ts'

async function listen(server: Server): Promise<string> {
  onTestFinished(async () => {
    if (!server.listening) return
    await new Promise<void>((resolve, reject) => server.close((error) => {
      if (error) reject(error)
      else resolve()
    }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP listener')
  return `http://127.0.0.1:${address.port}`
}

async function fixture(status: number) {
  let targetRequests = 0
  const target = await listen(createServer((request, response) => {
    targetRequests++
    request.resume()
    response.writeHead(204).end()
  }))
  const origin = await listen(createServer((request, response) => {
    request.resume()
    response.writeHead(status, { location: `${target}/collect` }).end()
  }))
  return { origin, targetRequests: () => targetRequests }
}

it.each([301, 302, 303, 307, 308])('rejects HTTP %i before contacting the redirect target', async (status) => {
  const f = await fixture(status)
  const provider = new ExaSearchProvider(() => ({
    baseURL: f.origin, mcpURL: 'https://mcp.exa.test/mcp', maxResults: 1,
    timeoutMs: 5000, maxResponseBytes: 65536, resolveApiKey: async () => 'redirect-test-key',
  }))
  await expect(provider.search({ query: 'private query' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  expect(f.targetRequests()).toBe(0)
})

it('observes target contact when native fetch follows a redirect', async () => {
  const f = await fixture(307)
  await fetch(`${f.origin}/search`, {
    method: 'POST', headers: { 'x-api-key': 'redirect-test-key' }, body: 'private query',
  })
  expect(f.targetRequests()).toBe(1)
})
