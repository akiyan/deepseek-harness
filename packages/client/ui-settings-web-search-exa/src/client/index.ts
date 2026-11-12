/** Exa settings registration on the Plugins page. */
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ExaSearchCard } from './ExaSearchCard.tsx'
import {
  WEB_EXA_NS, WEB_NS, ExaSearchCardController,
} from './exa-search-card-controller.ts'
import type { ExaSearchSettings, WebProviderSelection } from './exa-search-card-controller.ts'
import { de, en, es, fr, ja, pt, ru, zh, type ExaSearchSettingsLocaleKey } from './locales.ts'

export type { ExaSearchCardProps } from './ExaSearchCard.tsx'
export type {
  ExaSearchCardFace, ExaSearchCardScopes, ExaSearchCardState,
  ExaSearchSettings, WebProviderSelection,
} from './exa-search-card-controller.ts'
export type { ExaSearchSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Exa search settings page copy. */
    'settings.webSearchExa': ExaSearchSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.webSearchExa'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']

/**
 * Mount the Exa search settings page while the Host serves its namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-settings-web-search-exa: dictionaries')
  const card = new ExaSearchCardController({
    web: ctx.configForms.get<WebProviderSelection>(WEB_NS),
    provider: ctx.configForms.get<ExaSearchSettings>(WEB_EXA_NS),
  }, ctx)
  ctx.effect(() => () => { card.dispose() }, 'ui-settings-web-search-exa: form subscription')
  // The credential the page reports is not part of any settings section, so
  // no scope publishes when one is written. This is the only signal that a key
  // written on another surface reached the Host.
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', (ref) => { card.refreshCredential(ref) }),
    'ui-settings-web-search-exa: credential invalidations',
  )
  ctx.effect(() => ctx.configForms.whileServed([WEB_EXA_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'web-search-exa', order: 22, label: () => t('title'), locale: NS, inject: () => card.inject(),
  }, ExaSearchCard))), 'ui-settings-web-search-exa: page')
}
