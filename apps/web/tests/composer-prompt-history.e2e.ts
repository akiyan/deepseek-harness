/** Real composer history browsing, native cursor navigation, and persisted working drafts. */
import { fileURLToPath } from 'node:url'
import { chromium, webkit, type Page } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { compareOrRefreshGolden, webSnapshotMode, launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot, writeComposerDraft } from './support.ts'

/** Move the browser selection to one edge without changing the editor document. */
async function selectEdge(page: Page, start: boolean): Promise<void> {
  await page.locator('[data-composer-input][contenteditable="true"]').evaluate((input, first) => {
    input.focus()
    const range = document.createRange()
    range.selectNodeContents(input)
    range.collapse(first)
    const selection = window.getSelection()
    if (selection === null) throw new Error('Browser selection is unavailable')
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, start)
}

it.each([{ name: 'Chromium', engine: chromium }, { name: 'WebKit', engine: webkit }].flatMap(browser =>
  [1, 2].map(turns => ({ ...browser, turns }))))(
  'recalls $turns prompts and preserves working drafts in $name', async ({ engine, turns }) => {
    const scaffold = await launchWebScaffold({})
    const resources: { browser?: Awaited<ReturnType<typeof engine.launch>> } = {}
    onTestFinished(async () => {
      try { await resources.browser?.close() } finally { await scaffold.close() }
    })
    const browser = await engine.launch()
    resources.browser = browser
    const fixture = createChatScrollFixture({ markerPrefix: 'PROMPT_HISTORY', title: 'Prompt history', turns })
    await seedSession(scaffold, fixture.log, 'composer-prompt-history')
    const page = await newEnglishPage(browser)
    const errors = watchConsole(page)
    try {
      await page.goto(scaffold.authenticatedUrl)
      await connectFreshWorkspace(page, scaffold.workspaceCwd, 'prompt-history')
      await page.getByRole('button', { name: 'Search sessions', exact: true }).click()
      await page.getByRole('textbox', { name: 'Search session names', exact: true }).fill(fixture.markers.user(1))
      const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
      await expect.poll(() => result.count()).toBe(1)
      await result.click()
      await page.getByText(fixture.markers.assistant(turns), { exact: false }).last().waitFor()
      const input = page.locator('[data-composer-input][contenteditable="true"]').first()
      const observations: string[] = []
      await input.focus()
      await input.press('ArrowUp')
      await expect.poll(() => input.innerText()).toContain(fixture.markers.user(turns))
      await selectEdge(page, true)
      await input.press('ArrowDown')
      await expect.poll(() => input.textContent()).toBe('')
      const draft = 'unfinished working draft'
      await writeComposerDraft(page, input, draft)
      await input.press('ArrowUp')
      await expect.poll(() => input.innerText()).toContain(fixture.markers.user(turns))
      if (turns > 1) {
        observations.push(`recalled: ${(await input.innerText()).split(' ')[0]}`)
        await selectEdge(page, true)
        await input.press('ArrowUp')
        await expect.poll(() => input.innerText()).toContain(fixture.markers.user(1))
        observations.push(`recalled: ${(await input.innerText()).split(' ')[0]}`)
        await input.press('ArrowDown')
        await expect.poll(() => input.innerText()).toContain(fixture.markers.user(turns))
      }
      await input.press('ArrowDown')
      await expect.poll(() => input.innerText()).toBe(draft)
      observations.push(`restored: ${await input.innerText()}`)

      const multiline = 'first line\nsecond line'
      await writeComposerDraft(page, input, 'first line')
      await input.press('Shift+Enter')
      await page.keyboard.type('second line')
      await input.press('ArrowUp')
      expect(await input.innerText()).toBe(multiline)
      await input.press('Shift+ArrowUp')
      expect(await input.innerText()).toBe(multiline)

      await writeComposerDraft(page, input, 'wrapped '.repeat(100))
      await input.press('ArrowUp')
      expect(await input.innerText()).not.toContain(fixture.markers.user(turns))
      await writeComposerDraft(page, input, draft)
      await input.press('ArrowUp')
      await expect.poll(() => input.innerText()).toContain(fixture.markers.user(turns))
      await page.reload()
      await expect.poll(() => input.innerText()).toBe(draft)
      observations.push(`after reload: ${await input.innerText()}`)
      if (turns > 1) await compareOrRefreshGolden(fileURLToPath(new URL('./expected/composer-prompt-history/history.expected.md', import.meta.url)), observations.join('\n'), webSnapshotMode())
      expect(errors.pageErrors).toEqual([])
    } catch (error) {
      await saveFailureShot(page, `web-e2e-prompt-history-${engine.name()}`)
      throw error
    }
  }, 90_000,
)
