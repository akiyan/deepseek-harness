/** Exa selection never changes fetch; keys use credential RPC, not settings writes. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { ExaSearchCardController } from '../src/client/exa-search-card-controller.ts'
import type { ExaSearchSettings, WebProviderSelection } from '../src/client/exa-search-card-controller.ts'

function bench() {
  const web = stubConfigForm<WebProviderSelection>()
  const provider = stubConfigForm<ExaSearchSettings>()
  let configured = false
  const credentials = {
    describe: vi.fn(async () => ({ ok: true, value: { EXA_API_KEY: { configured, writable: true } } })),
    set: vi.fn(async () => { configured = true; return { ok: true, value: undefined } }),
    unset: vi.fn(async () => { configured = false; return { ok: true, value: undefined } }),
  }
  const controller = new ExaSearchCardController({ web: web.scope, provider: provider.scope }, { remote: { credentials } } as never)
  onTestFinished(() => { controller.dispose() })
  web.publish({ status: 'ready', writable: true, base: { searchProvider: 'deepseek-search-api' }, value: { searchProvider: 'deepseek-search-api' }, user: {} })
  provider.publish({ status: 'ready', writable: true, base: { maxResults: 5 }, value: { maxResults: 5 }, user: {} })
  web.mutate.mockResolvedValue(true)
  provider.mutate.mockResolvedValue(true)
  const face = controller.inject()
  return { web, provider, credentials, controller, face, state: () => face.hooks.exaSearchCard.getSnapshot() }
}

it('selects anonymous Exa without a key and touches only the search selection', async () => {
  const b = bench()
  await vi.waitFor(() => { expect(b.state().apiKeyWritable).toBe(true) })
  b.face.setExa(true)
  expect(b.state().useExa).toBe(true)
  b.face.save()
  await vi.waitFor(() => { expect(b.web.mutate).toHaveBeenCalled() })
  expect(b.web.mutate.mock.calls[0]?.[0]).toEqual([{ op: 'set', path: ['searchProvider'], value: 'exa' }])
  expect(b.credentials.set).not.toHaveBeenCalled()
})

it('stores the write-only key separately and can remove it without losing selection drafts', async () => {
  const b = bench()
  await vi.waitFor(() => { expect(b.state().apiKeyWritable).toBe(true) })
  b.face.edit('apiKey', 'test-exa-key')
  b.face.save()
  await vi.waitFor(() => { expect(b.credentials.set).toHaveBeenCalledWith('EXA_API_KEY', 'test-exa-key') })
  await vi.waitFor(() => { expect(b.state().apiKeyConfigured).toBe(true); expect(b.state().saving).toBe(false) })
  expect(b.web.mutate).not.toHaveBeenCalled()
  expect(b.provider.mutate).not.toHaveBeenCalled()
  expect(b.state().apiKey.text).toBe('')
  b.face.setExa(true)
  b.face.clearApiKey()
  await vi.waitFor(() => { expect(b.state().apiKeyConfigured).toBe(false) })
  expect(b.state().useExa).toBe(true)
  expect(b.credentials.unset).toHaveBeenCalledWith('EXA_API_KEY')
})

it.each(['0', '-1', '1.5', '101', 'not a number'])('rejects invalid result count %s before any writes', (text) => {
  const b = bench()
  b.face.edit('maxResults', text)
  expect(b.state().invalid).toBe(true)
  b.face.save()
  expect(b.provider.mutate).not.toHaveBeenCalled()
})

it('discards an unsaved key without writing credentials', () => {
  const b = bench()
  b.face.edit('apiKey', 'test-exa-key')
  b.face.discard()
  expect(b.state().apiKey.text).toBe('')
  expect(b.credentials.set).not.toHaveBeenCalled()
})

it('retains a failed credential edit for correction without persisting it as settings', async () => {
  const b = bench()
  b.credentials.set.mockRejectedValue(new Error('offline'))
  b.face.edit('apiKey', 'test-exa-key')
  b.face.save()
  await vi.waitFor(() => { expect(b.state().failed).toBe(true) })
  expect(b.state().apiKey.text).toBe('test-exa-key')
  expect(b.web.mutate).not.toHaveBeenCalled()
})
