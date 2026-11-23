// @vitest-environment jsdom
/** Prompt recall preserves the working draft across persistence and asynchronous history reads. */
import { MutableSessionEventSource, type SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SessionInputShell, type SessionInputDeps } from '../src/client/input/facade.ts'
import type { DraftSnapshot } from '../src/client/contract/draft-editor.ts'

function prompt(seq: number, text: string): SessionEventLikeEntry {
  return { type: 'event', event: {
    type: 'user/message', seq: SessionSeq(seq), time: 0, surfaceOp: 'append',
    data: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
  } }
}

function eventWindow(entries: readonly SessionEventLikeEntry[], hasMore = false): MutableSessionEventSource {
  const events = new MutableSessionEventSource()
  events.replace(entries, hasMore)
  return events
}

function shellFor(overrides: Partial<SessionInputDeps> = {}) {
  const ctx = new Context()
  const shell = new SessionInputShell({
    actx: ctx,
    defaultSink: () => Promise.resolve({ kind: 'success' }),
    commandAttachments: { serialize: () => Promise.resolve([]), release: () => {}, unsupportedNotice: token => token },
    events: eventWindow([prompt(10, 'older prompt'), prompt(11, 'latest prompt')]),
    ...overrides,
  })
  onTestFinished(async () => { shell.dispose(); await ctx.fiber.dispose() })
  return shell
}

it('walks back and forward and restores the exact semantic working draft', () => {
  const shell = shellFor()
  const draft: DraftSnapshot = {
    text: 'work file',
    references: [{ source: 'reference', ref: 'file', label: 'file', clipboardText: 'file', offset: 5, length: 4 }],
  }
  shell.setDraft(draft)
  const saved = shell.draftSnapshot
  const write = vi.fn()
  shell.bindDraftPersistence(write)
  shell.persistCurrentDraft()
  expect(shell.recallHistory('newer')).toBe(false)
  expect(shell.recallHistory('older')).toBe(true)
  expect(shell.snapshot.draft).toBe('latest prompt')
  shell.recallHistory('older')
  expect(shell.snapshot.draft).toBe('older prompt')
  expect(shell.recallHistory('older')).toBe(false)
  shell.persistCurrentDraft()
  expect(write.mock.calls.every(([value]) => value === saved)).toBe(true)
  shell.recallHistory('newer')
  expect(shell.snapshot.draft).toBe('latest prompt')
  shell.recallHistory('newer')
  expect(shell.draftSnapshot).toEqual(saved)
  expect(shell.snapshot.occurrences).toHaveLength(1)
})

it('restores the working draft after resending edited history and leaves failed sends editable', async () => {
  const send = vi.fn<SessionInputDeps['defaultSink']>().mockResolvedValueOnce({ kind: 'error', text: 'retry' }).mockResolvedValue({ kind: 'success' })
  const shell = shellFor({ defaultSink: send })
  shell.setDraft('unfinished')
  const saved = shell.draftSnapshot
  const write = vi.fn()
  shell.bindDraftPersistence(write)
  shell.persistCurrentDraft()
  shell.recallHistory('older')
  shell.paste(' revised')
  shell.submit('queue')
  await vi.waitFor(() => { expect(shell.snapshot.phase).toBe('plain') })
  expect(shell.snapshot.draft).toBe('latest prompt revised')
  expect(write).toHaveBeenLastCalledWith(saved)
  shell.submit('queue')
  await vi.waitFor(() => { expect(shell.snapshot.draft).toBe('unfinished') })
  expect(send.mock.calls[1]?.[0]).toBe('latest prompt revised')
  expect(shell.isRecallingPrompt()).toBe(false)
})

it('keeps recall local to each Session and accepts an explicit draft replacement', () => {
  const first = shellFor()
  const second = shellFor({ events: eventWindow([]) })
  first.setDraft('first draft')
  second.setDraft('second draft')
  first.recallHistory('older')
  expect(second.recallHistory('older')).toBe(false)
  expect(second.snapshot.draft).toBe('second draft')
  first.setDraft('replacement')
  expect(first.recallHistory('newer')).toBe(false)
  expect(first.snapshot.draft).toBe('replacement')
})

it.each(['edit', 'return', 'dispose'] as const)('does not overwrite a newer %s when older history arrives', async (change) => {
  const events = eventWindow([prompt(10, 'latest')], true)
  const pending = Promise.withResolvers<undefined>()
  const loadOlder = vi.fn(() => pending.promise)
  const shell = shellFor({ events, loadOlder })
  shell.setDraft('working')
  shell.recallHistory('older')
  shell.recallHistory('older')
  shell.recallHistory('older')
  expect(loadOlder).toHaveBeenCalledTimes(1)
  if (change === 'edit') shell.paste(' edited')
  else if (change === 'return') shell.recallHistory('newer')
  else shell.dispose()
  const before = shell.snapshot.draft
  events.prepend([prompt(9, 'oldest')], false)
  pending.resolve(undefined)
  await pending.promise
  expect(shell.snapshot.draft).toBe(before)
})

it('loads through a page containing only a consecutive repeat and returns to the working draft', async () => {
  const events = eventWindow([prompt(10, 'latest')], true)
  const loadOlder = vi.fn<() => Promise<void>>()
    .mockImplementationOnce(async () => { events.prepend([prompt(9, 'latest')], true) })
    .mockImplementationOnce(async () => { events.prepend([prompt(8, 'oldest')], false) })
  const shell = shellFor({ events, loadOlder })
  shell.setDraft('working')
  shell.recallHistory('older')
  shell.recallHistory('older')
  await vi.waitFor(() => { expect(shell.snapshot.draft).toBe('oldest') })
  expect(loadOlder).toHaveBeenCalledTimes(2)
  shell.recallHistory('newer')
  expect(shell.snapshot.draft).toBe('latest')
  shell.recallHistory('newer')
  expect(shell.snapshot.draft).toBe('working')
})

it('does not capture a draft when there are no prompts or earlier pages', () => {
  const loadOlder = vi.fn(async () => {})
  const shell = shellFor({ events: eventWindow([]), loadOlder })
  const write = vi.fn()
  shell.bindDraftPersistence(write)
  shell.setDraft('working')
  expect(shell.recallHistory('older')).toBe(false)
  shell.paste(' edited')
  expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'working edited' }))
  expect(loadOlder).not.toHaveBeenCalled()
})

it('keeps saving edits while the first prompt page is being loaded', async () => {
  const events = eventWindow([], true)
  const pending = Promise.withResolvers<undefined>()
  const shell = shellFor({ events, loadOlder: () => pending.promise })
  const write = vi.fn()
  shell.bindDraftPersistence(write)
  shell.setDraft('working')
  shell.recallHistory('older')
  shell.paste(' edited')
  events.prepend([prompt(10, 'old prompt')], false)
  pending.resolve(undefined)
  await pending.promise
  expect(shell.snapshot.draft).toBe('working edited')
  expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'working edited' }))
  expect(shell.isRecallingPrompt()).toBe(false)
})

it.each(['', 'unfinished draft'])('returns from a single prompt to the original draft %j', (draft) => {
  const shell = shellFor({ events: eventWindow([prompt(10, 'only prompt')]) })
  shell.setDraft(draft)
  expect(shell.isRecallingPrompt()).toBe(false)
  shell.recallHistory('older')
  expect(shell.isRecallingPrompt()).toBe(true)
  expect(shell.snapshot.draft).toBe('only prompt')
  expect(shell.recallHistory('older')).toBe(false)
  shell.recallHistory('newer')
  expect(shell.snapshot.draft).toBe(draft)
  expect(shell.isRecallingPrompt()).toBe(false)
})
