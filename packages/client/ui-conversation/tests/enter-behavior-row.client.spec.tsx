// @vitest-environment jsdom
import { contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector, makeTranslate, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session-status/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { EnterBehaviorRow } from '../src/client/settings/EnterBehaviorRow.tsx'
import type { EnterBehaviorRowProps } from '../src/client/settings/EnterBehaviorRow.tsx'
import { ComposerSubmissionPolicy } from '../src/client/input/submission-policy.ts'
import { en } from '../src/client/locales.ts'
import { PromptSuggestionRow, type PromptSuggestionSettings } from '../src/client/settings/PromptSuggestionRow.tsx'
import { PROMPT_SUGGESTION_SETTINGS_LOCALES } from '../src/client/settings/prompt-suggestion-locales.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, phase: 'ready', projectionsBySession: {},
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  }))
}

function noPendingInteraction() {
  return bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map()))
}

function standardProps(): GlobalStandardProps {
  return {
    usePanelInfo: selector => selector({ activePanelId: null }),
    useSessions: emptySessions(),
    useSessionStatus: noPendingInteraction(),
    useSessionRetainInfo: () => undefined,
    useResource,
    useWorkspaces: emptyWorkspaces(),
    ...allowAllAccess,
    useContextMenu: contextMenuHook(),
  }
}

function mount() {
  const policy = new ComposerSubmissionPolicy()
  const setBusyEnter = vi.fn((behavior: 'queue' | 'steer') => { policy.setBusyEnter(behavior) })
  const props: EnterBehaviorRowProps = {
    ...standardProps(),
    useBusyEnter: bindSnapshotSelector(policy.busyEnter),
    setBusyEnter,
    t: makeTranslate(en),
  }
  render(<EnterBehaviorRow {...props} />)
  return { policy, setBusyEnter }
}

describe('EnterBehaviorRow', () => {
  it('explains the busy-only scope over Enter and Send and shows Queue by default', () => {
    mount()
    expect(screen.getByText('Send behavior while busy')).toBeDefined()
    expect(screen.getByText('What Enter and the Send button do while the agent is running; Cmd/Ctrl+Enter uses the other behavior')).toBeDefined()
    expect(screen.getByRole('button', { name: /Queue/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('selects Steer, follows later preference changes, and closes outside', () => {
    const b = mount()
    const trigger = screen.getByRole('button', { name: /Queue/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Steer' }))
    expect(b.setBusyEnter).toHaveBeenCalledWith('steer')
    expect(screen.getByRole('button', { name: /Steer/ })).toBeDefined()

    act(() => { b.policy.setBusyEnter('queue') })
    const queueTrigger = screen.getByRole('button', { name: /Queue/ })
    fireEvent.click(queueTrigger)
    expect(screen.getByRole('menuitem', { name: 'Steer' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Steer' })).toBeNull()
  })
})

describe('PromptSuggestionRow', () => {
  it('renders only the one-line description in the Plugins card summary', () => {
    const form = stubConfigForm<PromptSuggestionSettings>()
    const { en: messages } = PROMPT_SUGGESTION_SETTINGS_LOCALES
    render(<PromptSuggestionRow {...standardProps()} view="summary" useSuggestionSettings={bindSnapshotSelector(form.scope)}
      t={makeTranslate(messages)} setEnabled={() => Promise.resolve(false)} />)
    expect(screen.getByText(messages.summary)).toBeDefined()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('describes the auxiliary request and preserves focus across failed and accepted saves', async () => {
    const form = stubConfigForm<PromptSuggestionSettings>()
    const { en: messages } = PROMPT_SUGGESTION_SETTINGS_LOCALES
    const first = Promise.withResolvers<boolean>()
    const setEnabled = vi.fn(async (_enabled: boolean) => true).mockImplementationOnce(() => first.promise)
    form.publish({ status: 'unavailable' })
    render(<PromptSuggestionRow {...standardProps()} view="page" useSuggestionSettings={bindSnapshotSelector(form.scope)}
      t={makeTranslate(messages)} setEnabled={setEnabled} />)
    expect(screen.queryByRole('switch')).toBeNull()

    act(() => { form.publish({ status: 'ready', value: { promptSuggestionsEnabled: true }, writable: true }) })
    const control = screen.getByRole('switch', { name: messages.toggle, description: messages.description })
    expect(control.getAttribute('aria-checked')).toBe('true')
    act(() => { control.focus() })
    fireEvent.click(control)
    fireEvent.click(control)
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith(false)
    expect(control.getAttribute('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(control)
    await act(async () => { first.resolve(false) })
    expect(screen.getByRole('alert').textContent).toBe(messages.saveFailed)
    expect(control.getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      fireEvent.click(control)
      form.publish({ value: { promptSuggestionsEnabled: false } })
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(control.getAttribute('aria-checked')).toBe('false')
    expect(document.activeElement).toBe(control)

    setEnabled.mockRejectedValueOnce(new Error('disconnected'))
    await act(async () => { fireEvent.click(control) })
    expect(screen.getByRole('alert').textContent).toBe(messages.saveFailed)
  })
})
