/** Real Exa settings page; credential and selection writes do not perform searches. */
import { chromium, webkit } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

it.each([{ name: 'Chromium', engine: chromium }, { name: 'WebKit', engine: webkit }])(
  'configures Exa without dispatching searches in $name', async ({ engine }) => {
    const scaffold = await launchWebScaffold({})
    const resources: { browser?: Awaited<ReturnType<typeof engine.launch>> } = {}
    onTestFinished(async () => {
      try { await resources.browser?.close() } finally { await scaffold.close() }
    })
    const browser = await engine.launch()
    resources.browser = browser
    const page = await newEnglishPage(browser)
    const errors = watchConsole(page)
    let searches = 0
    await page.route('https://api.exa.ai/**', async (route) => { searches++; await route.abort() })
    try {
      await page.goto(scaffold.authenticatedUrl)
      await page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Plugins', exact: true }).click()
      const panel = page.locator('[data-plugin-panel]')
      await panel.getByRole('button', { name: 'View Exa search settings', exact: true }).click()
      await page.getByLabel('Results per search', { exact: true }).waitFor()
      await expect.poll(() => page.getByText('Anonymous MCP', { exact: true }).count()).toBe(1)
      await page.getByRole('switch', { name: 'Use Exa for web search', exact: true }).click()
      await page.getByLabel('Results per search', { exact: true }).fill('3')
      await page.getByLabel('API key', { exact: true }).fill('test-exa-key')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect.poll(() => page.getByText('REST API', { exact: true }).count()).toBe(1)
      await expect.poll(() => page.getByLabel('API key', { exact: true }).inputValue()).toBe('')
      await page.getByRole('button', { name: 'Remove API key', exact: true }).click()
      await page.getByText('Anonymous MCP', { exact: true }).waitFor()
      await page.setViewportSize({ width: 390, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(searches).toBe(0)
      expect(errors.pageErrors).toEqual([])
    } catch (error) {
      await saveFailureShot(page, `exa-settings-${engine.name()}`)
      throw error
    }
  }, 90_000,
)
