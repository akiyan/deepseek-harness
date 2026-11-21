// @vitest-environment jsdom
/** Prompt recall preserves the working draft across persistence and asynchronous history reads. */
import { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SessionInputShell } from '../src/client/input/facade.ts'
import type { SessionInputDeps } from '../src/client/input/facade.ts'
import type { DraftSnapshot } from '../src/client/contract/draft-editor.ts'
import { readPromptHistory } from '../src/client/input/prompt-history.ts'
import type { PromptHistoryItem } from '../src/client/input/prompt-history.ts'

function item(text: string): PromptHistoryItem {
  return { id: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }).id, text }
}

function shellFor(overrides: Partial<SessionInputDeps> = {}) {
  const ctx = new Context()
  const shell = new SessionInputShell({
    actx: ctx,
    defaultSink: () => Promise.resolve({ kind: 'success' }),
    commandAttachments: { serialize: () => Promise.resolve([]), release: () => {}, unsupportedNotice: token => token },
    promptHistory: () => [item('older prompt'), item('latest prompt')],
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
  expect(shell.recallPrompt('down')).toBe(false)
  expect(shell.recallPrompt('up')).toBe(true)
  expect(shell.snapshot.draft).toBe('latest prompt')
  shell.recallPrompt('up')
  expect(shell.snapshot.draft).toBe('older prompt')
  shell.recallPrompt('up')
  expect(shell.snapshot.draft).toBe('older prompt')
  shell.persistCurrentDraft()
  expect(write.mock.calls.every(([value]) => value === saved)).toBe(true)
  shell.recallPrompt('down')
  expect(shell.snapshot.draft).toBe('latest prompt')
  shell.recallPrompt('down')
  expect(shell.draftSnapshot).toEqual(saved)
  expect(shell.snapshot.occurrences).toHaveLength(1)
})

it('restores the working draft after resending history and leaves failed sends editable', async () => {
  const send = vi.fn<SessionInputDeps['defaultSink']>().mockResolvedValueOnce({ kind: 'error', text: 'retry' }).mockResolvedValue({ kind: 'success' })
  const shell = shellFor({ defaultSink: send })
  shell.setDraft('unfinished')
  shell.recallPrompt('up')
  shell.paste(' revised')
  shell.submit('queue')
  await vi.waitFor(() => { expect(shell.snapshot.phase).toBe('plain') })
  expect(shell.snapshot.draft).toBe('latest prompt revised')
  shell.submit('queue')
  await vi.waitFor(() => { expect(shell.snapshot.draft).toBe('unfinished') })
  expect(send.mock.calls[1]?.[0]).toBe('latest prompt revised')
})

it('keeps recall local to each Session and accepts an explicit draft replacement', () => {
  const first = shellFor()
  const second = shellFor({ promptHistory: () => [] })
  first.setDraft('first draft')
  second.setDraft('second draft')
  first.recallPrompt('up')
  expect(second.recallPrompt('up')).toBe(false)
  expect(second.snapshot.draft).toBe('second draft')
  first.setDraft('replacement')
  expect(first.recallPrompt('down')).toBe(false)
  expect(first.snapshot.draft).toBe('replacement')
})

it.each(['edit', 'return', 'dispose'] as const)('does not overwrite a newer %s when older history arrives', async (change) => {
  const latest = item('latest')
  let resolve: ((items: readonly PromptHistoryItem[]) => void) | undefined
  const pending = new Promise<readonly PromptHistoryItem[]>((done) => { resolve = done })
  const older = vi.fn(() => pending)
  const shell = shellFor({ promptHistory: () => [latest], olderPromptHistory: older })
  shell.setDraft('working')
  shell.recallPrompt('up')
  shell.recallPrompt('up')
  shell.recallPrompt('up')
  expect(older).toHaveBeenCalledTimes(1)
  if (change === 'edit') shell.paste(' edited')
  else if (change === 'return') shell.recallPrompt('down')
  else shell.dispose()
  const before = shell.snapshot.draft
  resolve?.([item('oldest'), latest])
  await pending
  await Promise.resolve()
  expect(shell.snapshot.draft).toBe(before)
})

it('continues into older loaded pages and can return to the working draft', async () => {
  const latest = item('latest')
  const shell = shellFor({ promptHistory: () => [latest], olderPromptHistory: () => Promise.resolve([item('oldest'), latest]) })
  shell.setDraft('working')
  shell.recallPrompt('up')
  shell.recallPrompt('up')
  await vi.waitFor(() => { expect(shell.snapshot.draft).toBe('oldest') })
  shell.recallPrompt('down')
  expect(shell.snapshot.draft).toBe('latest')
  shell.recallPrompt('down')
  expect(shell.snapshot.draft).toBe('working')
})

it('recalls only human-authored nonempty text from the Session event source', () => {
  const source = new MutableSessionEventSource()
  const human = createUserMessage({ content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }], source: { kind: 'user' } })
  const automatic = createUserMessage({ content: [{ type: 'text', text: 'automatic input' }], source: { kind: 'model', provider: 'test', model: 'test' } })
  const blank = createUserMessage({ content: [{ type: 'text', text: '  ' }], source: { kind: 'user' } })
  source.replace([human, automatic, blank].map((data, index) => ({
    type: 'event', event: { type: 'user/message', seq: SessionSeq(index + 1), time: index, data, surfaceOp: 'append' },
  })), false)
  expect(readPromptHistory(source)).toEqual([{ id: human.id, text: 'hello world' }])
})

it('does not capture a draft when there are no prompts or earlier pages', () => {
  const older = vi.fn(async () => [])
  const shell = shellFor({ promptHistory: () => [], canLoadOlderPrompts: () => false, olderPromptHistory: older })
  const write = vi.fn()
  shell.bindDraftPersistence(write)
  shell.setDraft('working')
  expect(shell.recallPrompt('up')).toBe(false)
  shell.paste(' edited')
  expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'working edited' }))
  expect(older).not.toHaveBeenCalled()
})

it('keeps saving edits while the first prompt page is being loaded', async () => {
  let finish: ((items: readonly PromptHistoryItem[]) => void) | undefined
  const pending = new Promise<readonly PromptHistoryItem[]>((resolve) => { finish = resolve })
  const shell = shellFor({ promptHistory: () => [], canLoadOlderPrompts: () => true, olderPromptHistory: () => pending })
  const write = vi.fn()
  shell.bindDraftPersistence(write)
  shell.setDraft('working')
  shell.recallPrompt('up')
  shell.paste(' edited')
  finish?.([item('old prompt')])
  await pending
  expect(shell.snapshot.draft).toBe('working edited')
  expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'working edited' }))
})

it.each(['', 'unfinished draft'])('returns from a single prompt to the original draft %j', (draft) => {
  const shell = shellFor({ promptHistory: () => [item('only prompt')], canLoadOlderPrompts: () => false })
  shell.setDraft(draft)
  expect(shell.isRecallingPrompt()).toBe(false)
  shell.recallPrompt('up')
  expect(shell.isRecallingPrompt()).toBe(true)
  expect(shell.snapshot.draft).toBe('only prompt')
  shell.recallPrompt('up')
  expect(shell.snapshot.draft).toBe('only prompt')
  shell.recallPrompt('down')
  expect(shell.snapshot.draft).toBe(draft)
  expect(shell.isRecallingPrompt()).toBe(false)
})
