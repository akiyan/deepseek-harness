// @vitest-environment jsdom
/** Explicit OAuth actions and browser-safe account display. */
import { act as actReact, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChatGPTCard } from '../src/client/ChatGPTCard.tsx'
import { en, ja } from '../src/client/locales.ts'
import { requestChatGPT } from '../src/client/chatgpt.ts'
import type { ChatGPTAction } from '../src/client/chatgpt.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('offers one Continue with ChatGPT action without an API-key input', () => {
  const act = vi.fn<(action: ChatGPTAction) => Promise<void>>(async () => {})
  render(<ChatGPTCard view={{ accounts: [], pending: false }} busy={false} act={act} t={key => en[key]} />)
  fireEvent.click(screen.getByRole('button', { name: en.chatgptContinue }))
  expect(act).toHaveBeenCalledWith({ action: 'start' })
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: en.chatgptReconnect })).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.queryByRole('link', { name: 'Manage usage' })).toBeNull()
})

it('shows only the active account with reconnect and sign-out actions', () => {
  const act = vi.fn<(action: ChatGPTAction) => Promise<void>>(async () => {})
  render(<ChatGPTCard view={{ active: 'first', accounts: [
    { id: 'first', label: 'user (1)', connected: true, sharing: true },
    { id: 'second', label: 'user (2)', connected: true, sharing: false },
  ], pending: false }} busy={false} act={act} t={key => en[key]} />)
  expect(screen.getByText('Using ChatGPT plan')).toBeTruthy()
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.queryByText('user (2)')).toBeNull()
  expect(screen.queryByRole('button', { name: en.chatgptContinue })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(act.mock.calls.map(call => call[0])).toEqual([
    { action: 'start', id: 'first' }, { action: 'logout', id: 'first' },
  ])
})

it('shows browser completion, cancellation, and persistent failure in Japanese', () => {
  const act = vi.fn<(action: ChatGPTAction) => Promise<void>>(async () => {})
  render(<ChatGPTCard view={{ accounts: [], pending: true, authorizeUrl: 'https://auth.openai.com/api/accounts/authorize?state=test' }}
    busy={false} error="Connection failed" act={act} t={key => ja[key]} />)
  expect(screen.getByRole('link', { name: ja.chatgptOpenBrowser }).getAttribute('rel')).toBe('noopener noreferrer')
  expect(screen.getByRole('alert').textContent).toBe('Connection failed')
  fireEvent.click(screen.getByRole('button', { name: ja.cancel }))
  expect(act).toHaveBeenCalledWith({ action: 'cancel' })
})

it('rejects a forged authorization URL before the browser can render it', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ accounts: [], pending: true, authorizeUrl: 'https://attacker.example/authorize' })))
  await expect(requestChatGPT()).rejects.toThrow('Invalid ChatGPT sign-in URL')
})

it('shows a pasted return query and clears it after submission', () => {
  const act = vi.fn<(action: ChatGPTAction) => Promise<void>>(async () => {})
  vi.stubGlobal('location', { hostname: 'remote.example' })
  const { rerender } = render(<ChatGPTCard view={{ accounts: [], pending: true, authorizeUrl: '/chatgpt/authorize' }} busy={false} act={act} t={key => en[key]} />)
  expect(screen.queryByLabelText(en.chatgptReturnUrl)).toBeNull()
  const link = screen.getByRole('link', { name: en.chatgptOpenBrowser })
  expect(link.getAttribute('target')).toBe('_blank')
  fireEvent.click(link)
  const input = screen.getByLabelText(en.chatgptReturnUrl) as HTMLInputElement
  const submit = screen.getByRole('button', { name: en.chatgptComplete }) as HTMLButtonElement
  expect(input.type).toBe('text')
  expect(document.activeElement).toBe(input)
  expect(input.getAttribute('autocapitalize')).toBe('none')
  expect(submit.disabled).toBe(true)
  fireEvent.change(input, { target: { value: 'code=secret&state=state' } })
  fireEvent.click(submit)
  expect(act).toHaveBeenCalledWith({ action: 'complete', url: 'code=secret&state=state' })
  expect(input.value).toBe('')
  rerender(<ChatGPTCard view={{ accounts: [], pending: true }} busy={true} act={act} t={key => en[key]} />)
  expect(input.readOnly).toBe(true)
  expect(document.activeElement).toBe(input)
})

it('uses JSON POST for mutations and preserves the Host error', async () => {
  const request = vi.fn(async () => Response.json({ error: 'Remote revocation was not confirmed.' }, { status: 400 }))
  vi.stubGlobal('fetch', request)
  await expect(requestChatGPT({ action: 'logout', id: 'account' })).rejects.toThrow('Remote revocation was not confirmed.')
  expect(request).toHaveBeenCalledWith('/chatgpt/account', expect.objectContaining({ method: 'POST', body: '{"action":"logout","id":"account"}' }))
})

it('keeps loopback login automatic after opening the separate authorization tab', () => {
  vi.stubGlobal('location', { hostname: '127.0.0.1' })
  render(<ChatGPTCard view={{ accounts: [], pending: true, authorizeUrl: '/chatgpt/authorize' }}
    busy={false} act={async () => {}} t={key => en[key]} />)
  fireEvent.click(screen.getByRole('link', { name: en.chatgptOpenBrowser }))
  expect(screen.queryByLabelText(en.chatgptReturnUrl)).toBeNull()
  expect(screen.getByRole('button', { name: en.cancel })).toBeTruthy()
})

it('forgets the remote completion step and pasted value when a login attempt ends', () => {
  vi.stubGlobal('location', { hostname: 'remote.example' })
  const props = { busy: false, act: async () => {}, t: (key: keyof typeof en) => en[key] }
  const { rerender } = render(<ChatGPTCard {...props} view={{ accounts: [], pending: true, authorizeUrl: '/chatgpt/authorize' }} />)
  fireEvent.click(screen.getByRole('link', { name: en.chatgptOpenBrowser }))
  fireEvent.change(screen.getByLabelText(en.chatgptReturnUrl), { target: { value: 'sensitive-return-url' } })
  rerender(<ChatGPTCard {...props} view={{ accounts: [], pending: false }} />)
  rerender(<ChatGPTCard {...props} view={{ accounts: [], pending: true, authorizeUrl: '/chatgpt/authorize' }} />)
  expect(screen.queryByLabelText(en.chatgptReturnUrl)).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: en.chatgptOpenBrowser }))
  expect(screen.getByLabelText<HTMLInputElement>(en.chatgptReturnUrl).value).toBe('')
})

it('hides signed-out identity and offers only continuing with ChatGPT', () => {
  const act = vi.fn<(action: ChatGPTAction) => Promise<void>>(async () => {})
  render(<ChatGPTCard view={{ active: 'signed-out', accounts: [
    { id: 'signed-out', label: 'signed-out@example.test', connected: false, sharing: false },
  ], pending: false }} busy={false} act={act} t={key => en[key]} />)
  expect(screen.queryByText('signed-out@example.test')).toBeNull()
  expect(screen.queryByLabelText(en.chatgptAccount)).toBeNull()
  expect(screen.queryByText(en.chatgptUsingPlan)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.chatgptContinue }))
  expect(act).toHaveBeenCalledWith({ action: 'start' })
  expect(screen.getAllByRole('button')).toHaveLength(1)
})

it('shows the automatically opened tab and one completion footer without usage settings', () => {
  vi.stubGlobal('location', { hostname: 'remote.example' })
  const act = vi.fn<(action: ChatGPTAction) => Promise<void>>(async () => {})
  render(<ChatGPTCard browserOpened view={{ accounts: [], pending: true, authorizeUrl: '/chatgpt/authorize' }}
    busy={false} act={act} onClose={() => {}} t={key => en[key]} />)
  expect(screen.getByRole('status').textContent).toBe(en.chatgptBrowserOpened)
  expect(screen.getByRole('link', { name: en.chatgptReopenBrowser }).getAttribute('href')).toBe('/chatgpt/authorize')
  expect(screen.queryByRole('link', { name: en.chatgptOpenBrowser })).toBeNull()
  expect(screen.queryByRole('link', { name: en.chatgptManageUsage })).toBeNull()
  expect(screen.queryByText(en.chatgptDescription)).toBeNull()
  expect(screen.getByLabelText(en.chatgptReturnUrl)).toBeTruthy()
  expect(screen.getAllByRole('button', { name: en.cancel })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: en.cancel }))
  expect(act).toHaveBeenCalledWith({ action: 'cancel' })
})

it('requires remote instructions to be confirmed before starting authorization', () => {
  vi.stubGlobal('location', { hostname: 'remote.example' })
  const act = vi.fn<(action: ChatGPTAction) => Promise<void>>(async () => {})
  render(<ChatGPTCard view={{ accounts: [], pending: false }} busy={false} act={act} t={key => en[key]} />)
  fireEvent.click(screen.getByRole('button', { name: en.chatgptContinue }))
  expect(screen.getByRole('dialog', { name: en.chatgptBeforeOpening })).toBeTruthy()
  expect(screen.getByText(en.chatgptCopyInstructions)).toBeTruthy()
  expect(act).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.cancel }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(act).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.chatgptContinue }))
  fireEvent.click(screen.getByRole('button', { name: en.chatgptConfirmOpen }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(act).toHaveBeenCalledWith({ action: 'start' })
})

it('focuses the return input before starting the remote authorization tab and retains it while preparing', async () => {
  vi.stubGlobal('location', { hostname: 'remote.example' })
  let finish: (() => void) | undefined
  const actionDone = new Promise<void>((resolve) => { finish = resolve })
  const act = vi.fn<(action: ChatGPTAction) => Promise<void>>(() => {
    expect(document.activeElement).toBe(screen.getByLabelText(en.chatgptReturnUrl))
    return actionDone
  })
  const { rerender } = render(<ChatGPTCard view={{ accounts: [], pending: false }} busy={false} act={act} t={key => en[key]} />)
  fireEvent.click(screen.getByRole('button', { name: en.chatgptContinue }))
  fireEvent.click(screen.getByRole('button', { name: en.chatgptConfirmOpen }))
  expect(act).toHaveBeenCalledWith({ action: 'start' })
  const input = screen.getByLabelText<HTMLInputElement>(en.chatgptReturnUrl)
  rerender(<ChatGPTCard view={{ accounts: [], pending: true, authorizeUrl: '/chatgpt/authorize' }} busy browserOpened act={act} t={key => en[key]} />)
  expect(document.activeElement).toBe(input)
  expect(input.disabled).toBe(false)
  expect(input.readOnly).toBe(true)
  await actReact(async () => { finish?.(); await actionDone })
  rerender(<ChatGPTCard view={{ accounts: [], pending: true, authorizeUrl: '/chatgpt/authorize' }} busy={false} browserOpened act={act} t={key => en[key]} />)
  expect(document.activeElement).toBe(input)
  expect(input.readOnly).toBe(false)
  fireEvent.click(screen.getByRole('link', { name: en.chatgptReopenBrowser }))
  expect(document.activeElement).toBe(input)
})
