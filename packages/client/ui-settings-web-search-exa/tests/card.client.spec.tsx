// @vitest-environment jsdom
/** Exa card controls and write-only credentials rendered with real settings primitives. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ExaSearchCard, type ExaSearchCardProps } from '../src/client/ExaSearchCard.tsx'
import type { ExaSearchCardState } from '../src/client/exa-search-card-controller.ts'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)

function bench(extra: Partial<ExaSearchCardState> = {}) {
  const field = { text: '', overridden: false, invalid: false }
  const store = createSnapshotStore<ExaSearchCardState>({
    available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
    switchAvailable: true, useExa: false, maxResults: { ...field, text: '5' }, apiKey: field,
    apiKeyConfigured: false, apiKeyWritable: true, ...extra,
  })
  const actions = { edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn(), setExa: vi.fn(), clearApiKey: vi.fn() }
  const props = { ...actions, view: 'page', t: (key: keyof typeof en) => en[key], useExaSearchCard: bindSnapshotSelector(store) } as ExaSearchCardProps
  render(<ExaSearchCard {...props} />)
  return actions
}

it('permits anonymous selection and never echoes a stored credential', () => {
  const actions = bench()
  fireEvent.click(screen.getByRole('switch', { name: en.useExa }))
  expect(actions.setExa).toHaveBeenCalledWith(true)
  const key = screen.getByLabelText(en.apiKey)
  expect(key.getAttribute('type')).toBe('password')
  expect(key.getAttribute('value')).toBe('')
  expect(screen.getByText(en.keyAnonymous)).toBeTruthy()
  fireEvent.change(key, { target: { value: 'test-exa-key' } })
  expect(actions.edit).toHaveBeenCalledWith('apiKey', 'test-exa-key')
  expect(actions.save).not.toHaveBeenCalled()
})

it('offers removal only for a configured writable key', () => {
  const actions = bench({ apiKeyConfigured: true })
  fireEvent.click(screen.getByRole('button', { name: en.removeKey }))
  expect(actions.clearApiKey).toHaveBeenCalledTimes(1)
  cleanup()
  bench({ apiKeyConfigured: true, apiKeyWritable: false })
  expect(screen.queryByRole('button', { name: en.removeKey })).toBeNull()
})
