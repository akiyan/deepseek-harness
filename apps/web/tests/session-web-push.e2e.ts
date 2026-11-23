/** Plugin manager profile toggles and loading the fork's Web Push bundle. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Locator } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const PACKAGE = '@akiyan/dsh-session-web-push'
const NATIVE_CARD = `[data-plugin-package="${PACKAGE}"]`
const SESSION_TITLE = 'Notification card test session'
const FIXTURES = new URL('./fixtures/plugins/', import.meta.url)
const SESSION_SEED = new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url)

it('keeps the notification bundle in the akiyan group and its browser settings on the package page', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
    profile: { packages: ['fixture-session-web-push', 'fixture-live-client'].map(dir => ({
      dir: fileURLToPath(new URL(dir, FIXTURES)),
    })) },
  })
  onTestFinished(() => scaffold.close())
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
  const sessionId = await seedSession(scaffold, await readFile(SESSION_SEED, 'utf8'), 'session-a466e315-9a11-4921-96aa-5762fbe4eb4d')
  await workspace.attachSession(sessionId)
  await scaffold.ctx.sessionController.rename({ sessionId, title: SESSION_TITLE })

  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
  const console = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'web-e2e-session-web-push'))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })

  const plugins = page.getByRole('navigation', { name: '全局面板' }).getByRole('button', { name: '插件', exact: true })
  const panel = page.locator('[data-plugin-panel]')
  const installed = panel.locator('[data-plugin-group="bundles"]')
  const card = panel.locator(`[data-plugin-group="akiyan"] ${NATIVE_CARD}`)
  const detail = panel.locator(`[data-plugin-detail="${PACKAGE}"]`)
  const settings = detail.getByRole('region', { name: 'Browser notification settings', exact: true })
  const toggle = (within: Locator) => within.getByRole('switch', { name: `启用 ${PACKAGE}`, exact: true })
  const openDetail = () => card.getByRole('button', { name: `查看 ${PACKAGE}`, exact: true }).click()
  const back = () => detail.getByRole('button', { name: '返回插件', exact: true }).click()

  async function expectCard(enabled: boolean): Promise<void> {
    await card.waitFor({ timeout: 20_000 })
    await expect.poll(() => toggle(card).getAttribute('aria-checked'), { timeout: 10_000 }).toBe(String(enabled))
    expect(await panel.locator(NATIVE_CARD).count()).toBe(1)
    expect(await installed.locator('[data-plugin-package="@fixture/live-client"]').count()).toBe(1)
    expect(await installed.locator(NATIVE_CARD).count()).toBe(0)
    expect(await panel.locator('[data-plugin-item="session-web-push"]').count()).toBe(0)
  }

  await plugins.click()
  await expectCard(false)
  await openDetail()
  await detail.waitFor()
  expect(await settings.count()).toBe(0)
  await toggle(detail).click()
  await settings.getByText('Browser settings from the fixture', { exact: true }).waitFor({ timeout: 30_000 })
  await back()
  await expectCard(true)

  // The same enabled bundle still contributes its separate session view.
  await page.getByRole('treeitem').filter({ has: page.getByText(SESSION_TITLE, { exact: true }) }).click({ timeout: 20_000 })
  await page.getByRole('tab', { name: 'Notifications', exact: true }).click({ timeout: 20_000 })
  await page.getByText('Session settings from the fixture', { exact: true }).waitFor()

  await plugins.click()
  await openDetail()
  await toggle(detail).click()
  await expect.poll(() => toggle(detail).getAttribute('aria-checked'), { timeout: 30_000 }).toBe('false')
  await settings.waitFor({ state: 'detached' })
  await back()
  await expectCard(false)
  await openDetail()
  await toggle(detail).click()
  await settings.getByText('Browser settings from the fixture', { exact: true }).waitFor({ timeout: 30_000 })
  expect(console.pageErrors).toEqual([])
}, 120_000)

// The standalone bundle's npm dependencies are not installed by the root pnpm workspace.
it.runIf(process.env.DSH_TEST_SESSION_WEB_PUSH === '1')('loads the fork bundle and serves its worker without requesting push settings over HTTP', async () => {
  const bundle = new URL('../../../plugins/session-web-push/', import.meta.url)
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: fileURLToPath(bundle), enabled: true }] },
  })
  onTestFinished(() => scaffold.close())

  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
  const console = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'web-e2e-fork-session-web-push'))
  const pushRequests: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/session-web-push/')) pushRequests.push(path)
  })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  expect(new URL(page.url()).protocol).toBe('http:')

  await page.getByRole('navigation', { name: '全局面板' }).getByRole('button', { name: '插件', exact: true }).click()
  const panel = page.locator('[data-plugin-panel]')
  const card = panel.locator(`[data-plugin-group="akiyan"] ${NATIVE_CARD}`)
  await card.waitFor({ timeout: 20_000 })
  expect(await panel.locator(NATIVE_CARD).count()).toBe(1)
  await card.getByRole('button', { name: '查看 Session push notifications', exact: true }).click()
  const detail = panel.locator(`[data-plugin-detail="${PACKAGE}"]`)
  await detail.getByRole('status').getByText('HTTPS connection required', { exact: true }).waitFor()
  expect(pushRequests).toEqual([])
  expect(console.pageErrors).toEqual([])

  const worker = await page.request.get(new URL('/session-web-push/worker.js', page.url()).href)
  expect(worker.status()).toBe(200)
  expect(worker.headers()['content-type']).toContain('text/javascript')
  expect(await worker.text()).toBe(await readFile(new URL('worker.js', bundle), 'utf8'))
}, 120_000)
