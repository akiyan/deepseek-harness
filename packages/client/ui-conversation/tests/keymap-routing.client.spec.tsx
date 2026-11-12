// @vitest-environment jsdom
/**
 * Keymap routing at the DOM boundary: synthetic keydowns on the
 * contenteditable reach the registered composer commands (the jsdom lane's
 * gesture entry, below the full component bench).
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from 'lexical'
import { registerPlainText } from '@lexical/plain-text'
import { registerComposerKeymap } from '../src/client/input/editor/keymap.ts'

describe('keymap keydown routing', () => {
  it('clears composition presentation on root swaps and unregisters pending callbacks', async () => {
    const editor = createEditor({ namespace: 'composition-root', onError: (e) => { throw e } })
    const first = document.createElement('div')
    const second = document.createElement('div')
    document.body.append(first, second)
    onTestFinished(() => {
      editor.setRootElement(null)
      first.remove()
      second.remove()
    })
    editor.setRootElement(first)
    const unregister = registerComposerKeymap(editor, {
      arbitrate: () => 'pass', space: () => false, dismissPopup: () => {},
      canSubmit: () => false, submit: () => {}, intakeFiles: () => {}, pasteText: () => {},
    })
    onTestFinished(unregister)
    fireEvent.compositionStart(first)
    expect(first.hasAttribute('data-composer-composing')).toBe(true)
    editor.setRootElement(second)
    expect(first.hasAttribute('data-composer-composing')).toBe(false)
    expect(second.hasAttribute('data-composer-composing')).toBe(false)
    fireEvent.compositionStart(first)
    expect(first.hasAttribute('data-composer-composing')).toBe(false)
    fireEvent.compositionStart(second)
    expect(second.hasAttribute('data-composer-composing')).toBe(true)
    fireEvent.compositionEnd(second, { data: '' })
    unregister()
    await Promise.resolve()
    expect(second.hasAttribute('data-composer-composing')).toBe(false)
    fireEvent.compositionStart(second)
    expect(second.hasAttribute('data-composer-composing')).toBe(false)
  })

  it('routes Enter to the keymap submit handler', () => {
    const editor = createEditor({ namespace: 'keymap-routing', onError: (e) => { throw e } })
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    editor.setRootElement(root)
    registerPlainText(editor)
    const submit = vi.fn()
    registerComposerKeymap(editor, {
      arbitrate: () => 'pass',
      space: () => false,
      dismissPopup: () => {},
      canSubmit: () => true,
      submit,
      intakeFiles: () => {},
      pasteText: () => {},
    })
    fireEvent.keyDown(root, { key: 'Enter' })
    expect(submit).toHaveBeenCalledWith(false)
    fireEvent.keyDown(root, { key: 'Enter', metaKey: true })
    expect(submit).toHaveBeenCalledWith(true)
  })

  it.each([
    { altKey: true },
    { altKey: true, metaKey: true },
    { altKey: true, ctrlKey: true },
    { ctrlKey: true, metaKey: true },
    { shiftKey: true, metaKey: true },
    { shiftKey: true, ctrlKey: true },
    { shiftKey: true, altKey: true },
  ])('leaves modified Enter %j available to application commands', async (modifiers) => {
    const editor = createEditor({ namespace: 'modified-enter', onError: (error) => { throw error } })
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    onTestFinished(() => { editor.setRootElement(null); root.remove() })
    editor.setRootElement(root)
    onTestFinished(registerPlainText(editor))
    const submit = vi.fn()
    const arbitrate = vi.fn(() => 'pass' as const)
    onTestFinished(registerComposerKeymap(editor, {
      arbitrate, space: () => false, dismissPopup: () => {}, canSubmit: () => true,
      submit, intakeFiles: () => {}, pasteText: () => {},
    }))
    editor.update(() => {
      const paragraph = $createParagraphNode().append($createTextNode('unsent draft'))
      $getRoot().append(paragraph)
      paragraph.selectEnd()
    }, { discrete: true })
    const applicationKeydown = vi.fn()
    document.addEventListener('keydown', applicationKeydown)
    onTestFinished(() => { document.removeEventListener('keydown', applicationKeydown) })

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...modifiers })
    root.dispatchEvent(event)
    await Promise.resolve()

    expect(submit).not.toHaveBeenCalled()
    expect(arbitrate).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(applicationKeydown).toHaveBeenCalledOnce()
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('unsent draft')
  })

  it('routes Tab through arbitration and passes when unconsumed', () => {
    const editor = createEditor({ namespace: 'keymap-routing', onError: (e) => { throw e } })
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    editor.setRootElement(root)
    registerPlainText(editor)
    const arbitrate = vi.fn<(key: string, composing: boolean) => 'consumed' | 'pick-highlighted' | 'pass'>()
      .mockReturnValueOnce('consumed')
      .mockReturnValueOnce('pick-highlighted')
      .mockReturnValue('pass')
    registerComposerKeymap(editor, {
      arbitrate,
      space: () => false,
      dismissPopup: () => {},
      canSubmit: () => true,
      submit: () => {},
      intakeFiles: () => {},
      pasteText: () => {},
    })
    const consumed = fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })
    expect(arbitrate).toHaveBeenCalledWith('tab', false)
    expect(consumed).toBe(false) // consumed: preventDefault fired
    const picked = fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })
    expect(picked).toBe(false) // picked: the completion replaces native traversal
    const passed = fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })
    expect(passed).toBe(true) // pass: the browser keeps native focus traversal

    // Shift+Tab is the menu's exit key, never its settle key.
    fireEvent.keyDown(root, { key: 'Tab', keyCode: 9, shiftKey: true })
    expect(arbitrate).toHaveBeenLastCalledWith('tabBack', false)
  })
})

it('gives completion menus, IME, selections, and modified arrows priority over prompt recall', () => {
  const editor = createEditor({ namespace: 'prompt-history-routing', onError: (error) => { throw error } })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  root.tabIndex = 0
  document.body.append(root)
  editor.setRootElement(root)
  const plain = registerPlainText(editor)
  const recall = vi.fn(() => true)
  const arbitrate = vi.fn<() => 'pass' | 'consumed'>(() => 'pass')
  const stop = registerComposerKeymap(editor, {
    arbitrate, recallPrompt: recall, space: () => false, dismissPopup: () => {},
    canSubmit: () => true, submit: () => {}, intakeFiles: () => {}, pasteText: () => {},
  })
  onTestFinished(() => { stop(); plain(); editor.setRootElement(null); root.remove() })
  editor.update(() => { $getRoot().append($createParagraphNode()).selectEnd() }, { discrete: true })
  root.focus()
  fireEvent.keyDown(root, { key: 'ArrowUp' })
  expect(recall).toHaveBeenLastCalledWith('up')
  recall.mockClear()
  for (const modifiers of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
    fireEvent.keyDown(root, { key: 'ArrowUp', ...modifiers })
  }
  expect(recall).not.toHaveBeenCalled()
  arbitrate.mockReturnValueOnce('consumed')
  fireEvent.keyDown(root, { key: 'ArrowDown' })
  expect(recall).not.toHaveBeenCalled()
  editor.update(() => {
    const text = $createTextNode('selected')
    $getRoot().clear().append($createParagraphNode().append(text))
    text.select(0, 3)
  }, { discrete: true })
  fireEvent.keyDown(root, { key: 'ArrowUp' })
  expect(recall).not.toHaveBeenCalled()
})

it.each(['up', 'down'] as const)('continues history %s navigation inside a recalled multiline prompt', (direction) => {
  const editor = createEditor({ namespace: 'prompt-history-lines', onError: (error) => { throw error } })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  root.tabIndex = 0
  document.body.append(root)
  editor.setRootElement(root)
  const plain = registerPlainText(editor)
  const recall = vi.fn(() => true)
  const recalling = vi.fn(() => false)
  const stop = registerComposerKeymap(editor, {
    arbitrate: () => 'pass', isRecallingPrompt: recalling, recallPrompt: recall,
    space: () => false, dismissPopup: () => {}, canSubmit: () => true,
    submit: () => {}, intakeFiles: () => {}, pasteText: () => {},
  })
  onTestFinished(() => { stop(); plain(); editor.setRootElement(null); root.remove() })
  editor.update(() => {
    const first = $createTextNode('first line')
    const last = $createTextNode('last line')
    $getRoot().append($createParagraphNode().append(first), $createParagraphNode().append(last))
    if (direction === 'up') last.selectEnd()
    else first.selectStart()
  }, { discrete: true })
  root.focus()
  const key = direction === 'up' ? 'ArrowUp' : 'ArrowDown'
  fireEvent.keyDown(root, { key })
  expect(recall).not.toHaveBeenCalled()
  recalling.mockReturnValue(true)
  expect(fireEvent.keyDown(root, { key })).toBe(false)
  expect(recall).toHaveBeenLastCalledWith(direction)
  recall.mockClear()
  fireEvent.keyDown(root, { key, shiftKey: true })
  expect(recall).not.toHaveBeenCalled()
})
