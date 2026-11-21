/** Next-message suggestions through the shipped Web composition and the real Session Remote. */
import { chromium, type Page } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, openSettings, writeComposerDraft } from './support.ts'

const PROVIDER = 'prompt-suggestion-test'
const MODEL = 'prompt-suggestion-model'
const PROMPT = 'ゲームギア向けのPSG出力を調べてください。'
const REPLY = 'GG向けの7曲を確認しました。曲頭基準で60 Hzに丸めれば、ビブラートと減衰を変えずに再生時間を補正できます。'
const SUGGESTION = 'ビブラートと減衰は変えず、GG向け出力を曲頭基準で60 Hzに丸めて、既存7曲を再変換して確認してください。'

class SuggestionAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override async listModels(provider: string) { return [{ provider, id: MODEL, name: MODEL }] }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const text = options.purpose === 'prompt-suggestion' ? JSON.stringify(SUGGESTION) : REPLY
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function setup() {
  const scaffold = await launchWebScaffold({ promptSuggestions: true })
  onTestFinished(() => scaffold.close())
  const adapter = new SuggestionAdapter()
  scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter([PROVIDER], adapter))
  await scaffold.ctx.agentDefaultModel.saveSelection({ provider: PROVIDER, model: MODEL })
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  return { scaffold, adapter, browser }
}

const settingsCopy = {
  en: {
    settings: 'Settings', plugins: 'Plugins', generalRow: 'Send behavior while busy', group: 'akiyan built-in plugin settings',
    title: 'Suggest the next message', open: 'View Suggest the next message', toggle: 'Show suggestions',
  },
  ja: {
    settings: '設定', plugins: 'プラグイン管理', generalRow: '実行中の送信動作', group: 'akiyan組み込みプラグイン設定',
    title: '次のメッセージを提案', open: '次のメッセージを提案を表示', toggle: '候補を表示',
  },
} as const

async function openSuggestionSettings(page: Page, locale: keyof typeof settingsCopy) {
  const copy = settingsCopy[locale]
  await openSettings(page, locale)
  const dialog = page.getByRole('dialog', { name: copy.settings })
  await dialog.getByText(copy.generalRow, { exact: true }).waitFor()
  expect(await dialog.getByRole('switch', { name: copy.title, exact: true }).count()).toBe(0)
  expect(await dialog.getByRole('switch', { name: copy.toggle, exact: true }).count()).toBe(0)
  await dialog.getByRole('button', { name: copy.plugins, exact: true }).click()
  const panel = page.locator('[data-plugin-panel]')
  const group = panel.locator('[data-plugin-group="akiyan"]')
  await group.getByRole('heading', { name: copy.group, exact: true }).waitFor()
  const card = group.getByRole('button', { name: copy.open, exact: true })
  expect(await group.getByRole('switch', { name: copy.toggle, exact: true }).count()).toBe(0)
  await card.press('Enter')
  await panel.getByRole('heading', { name: copy.title, exact: true }).waitFor()
  return panel.getByRole('switch', { name: copy.toggle, exact: true })
}

it('defaults on, inserts a Japanese suggestion without sending, and permits disabling the next call', async () => {
  const { scaffold, adapter, browser } = await setup()
  const page = await newEnglishPage(browser)
  const prefs = await newEnglishPage(browser)
  await page.emulateMedia({ colorScheme: 'light' })
  await prefs.emulateMedia({ colorScheme: 'light' })
  const tripwire = watchConsole(page)
  const settingsErrors = watchConsole(prefs)
  await prefs.goto(scaffold.authenticatedUrl)
  const toggle = await openSuggestionSettings(prefs, 'en')
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd, 'prompt-suggestion')

  const input = page.locator('[data-composer-input][contenteditable="true"]').first()
  const preview = page.locator('[data-composer-prompt-suggestion]')
  const send = async (text: string) => {
    await writeComposerDraft(page, input, text)
    const [sessionId] = await Promise.all([scaffold.whenTurnSettled(), input.press('Enter')])
    return sessionId
  }
  const id = await send(PROMPT)
  await expect.poll(() => preview.textContent()).toContain(SUGGESTION)
  expect(await preview.isVisible()).toBe(true)
  expect(await input.innerText()).not.toContain(SUGGESTION)
  expect(adapter.requests.map(request => request.purpose ?? 'conversation')).toEqual(['conversation', 'prompt-suggestion'])
  const events = () => scaffold.ctx.sessions.get(id)?.snapshotEvents() ?? []
  expect(events().filter(event => event.type === 'session/prompt-suggestion-request')).toMatchObject([{ ignorable: true }])
  expect(JSON.stringify(events())).not.toContain(SUGGESTION)

  await input.press('Enter')
  expect(adapter.requests).toHaveLength(2)
  await input.press('Tab')
  await expect.poll(() => input.innerText()).toBe(SUGGESTION)
  expect(await preview.count()).toBe(0)
  expect(adapter.requests).toHaveLength(2)
  await input.press('ControlOrMeta+z')
  await expect.poll(() => input.innerText()).not.toContain(SUGGESTION)
  await preview.waitFor()
  const editorFocused = () => input.evaluate(element => element === document.activeElement)
  await input.press('Shift+Tab')
  expect(await editorFocused()).toBe(false)
  expect(await preview.isVisible()).toBe(true)

  await input.press('Tab')
  await expect.poll(() => input.innerText()).toBe(SUGGESTION)
  expect(await editorFocused()).toBe(true)
  await input.press('ControlOrMeta+a')
  await input.press('Backspace')
  await preview.waitFor()
  expect(await input.innerText()).not.toContain(SUGGESTION)
  expect(await editorFocused()).toBe(true)
  expect(adapter.requests).toHaveLength(2)

  await page.getByRole('button', { name: 'Add files or run commands', exact: true }).click()
  const triggerMenu = page.locator('[data-trigger-menu]')
  await triggerMenu.waitFor()
  await preview.waitFor({ state: 'detached' })
  await input.press('Shift+Tab')
  await triggerMenu.waitFor({ state: 'detached' })
  await preview.waitFor()
  expect(await editorFocused()).toBe(true)
  expect(await input.innerText()).not.toContain(SUGGESTION)

  await input.press('Escape')
  await preview.waitFor({ state: 'detached' })
  await input.press('Tab')
  expect(await editorFocused()).toBe(false)
  expect(await input.innerText()).not.toContain(SUGGESTION)

  expect(await send(PROMPT)).toBe(id)
  await preview.waitFor()
  await page.setViewportSize({ width: 480, height: 920 })
  await preview.getByRole('button', { name: 'Insert suggested prompt' }).click()
  await expect.poll(() => input.innerText()).toBe(SUGGESTION)
  expect(adapter.requests).toHaveLength(4)

  await page.setViewportSize({ width: 1680, height: 1000 })
  await toggle.click()
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
  // A different connected page receives the same setting without a Host restart or reload.
  expect(await send(PROMPT)).toBe(id)
  await expect.poll(() => adapter.requests.length).toBe(5)
  expect(adapter.requests.filter(request => request.purpose === 'prompt-suggestion')).toHaveLength(2)
  expect(await preview.count()).toBe(0)
  expect(tripwire.pageErrors).toEqual([])
  expect(settingsErrors.pageErrors).toEqual([])
})

it('keeps a previously saved off value in the Japanese akiyan plugin settings', async () => {
  const { scaffold, browser } = await setup()
  // This is the same stored namespace and field the old General switch edited.
  await scaffold.ctx.settings.mutate('session-controller', [{
    op: 'set', path: ['promptSuggestionsEnabled'], value: false,
  }])
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', locale: 'ja-JP' })
  await page.goto(scaffold.authenticatedUrl)
  const toggle = await openSuggestionSettings(page, 'ja')
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
  expect(await toggle.evaluate(control => document.getElementById(control.getAttribute('aria-describedby') ?? '')?.textContent))
    .toContain('同じモデル提供元に送り')
  expect(await toggle.evaluate((control) => {
    const { left, right } = control.getBoundingClientRect()
    return left >= 0 && right <= document.documentElement.clientWidth
  })).toBe(true)
  await toggle.press('Space')
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
  expect(await toggle.evaluate(control => document.activeElement === control)).toBe(true)
  await page.reload()
  const reopened = await openSuggestionSettings(page, 'ja')
  await expect.poll(() => reopened.getAttribute('aria-checked')).toBe('true')
})

it('keeps the preview inside a narrow dark touch composer and accepts it with the Insert button', async () => {
  const { scaffold, adapter, browser } = await setup()
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'en-US',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
  })
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd, 'touch-suggestion')
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
  const input = page.locator('[data-composer-input][contenteditable="true"]').first()
  await writeComposerDraft(page, input, PROMPT)
  await Promise.all([
    scaffold.whenTurnSettled(),
    page.getByRole('button', { name: 'Send message', exact: true }).tap(),
  ])
  const preview = page.locator('[data-composer-prompt-suggestion]')
  const insert = preview.getByRole('button', { name: 'Insert suggested prompt' })
  await insert.waitFor()
  expect(await insert.evaluate(element => document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent)).toBe(SUGGESTION)
  expect(await insert.innerText()).toBe('Insert')
  const geometry = await preview.evaluate((element) => {
    const { left, right, height } = element.getBoundingClientRect()
    const { colorScheme } = getComputedStyle(document.documentElement)
    return { left, right, height, width: innerWidth, colorScheme }
  })
  expect(geometry.colorScheme).toBe('dark')
  expect(geometry.left).toBeGreaterThanOrEqual(0)
  expect(geometry.right).toBeLessThanOrEqual(geometry.width)
  expect(geometry.height).toBeLessThan(64)
  await insert.tap()
  await expect.poll(() => input.innerText()).toBe(SUGGESTION)
  expect(adapter.requests).toHaveLength(2)
  expect(await preview.count()).toBe(0)
})
