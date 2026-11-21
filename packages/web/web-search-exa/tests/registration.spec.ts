/** Real web seam registration and disposal, without search traffic. */
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { expect, it, onTestFinished } from 'vitest'
import * as plugin from '../src/index.ts'

it('registers Exa for search without replacing fetch and retracts with its fiber', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(WebRuntime, {})
  const fiber = ctx.plugin(plugin, {})
  await fiber
  expect(ctx.web.listProviders().search.map(provider => provider.id)).toEqual(['exa'])
  expect(ctx.web.listProviders().fetch).toEqual([])
  await fiber.dispose()
  expect(ctx.web.listProviders().search).toEqual([])
})
