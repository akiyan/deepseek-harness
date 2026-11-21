/** Staged Exa settings; credential writes remain outside the settings document. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SettingsFormModel, settingsNumberField, settingsTextField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsFieldState, SettingsFormActions, SettingsFormScope, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'

/** Provider configuration namespace. */
export const WEB_EXA_NS = 'web-search-exa'
/** Shared capability selection namespace. */
export const WEB_NS = 'web'
/** Configuration fields edited by this page. */
export interface ExaSearchSettings { maxResults?: number }
/** Only the search selection is staged; fetch is left untouched. */
export interface WebProviderSelection { searchProvider?: string }
/** One rendered settings snapshot. */
export interface ExaSearchCardState extends SettingsFormShell {
  switchAvailable: boolean
  useExa: boolean
  maxResults: SettingsFieldState
  apiKey: SettingsFieldState
  apiKeyConfigured: boolean
  apiKeyWritable: boolean
}
/** Settings page's injected actions and store. */
export interface ExaSearchCardFace extends SettingsFormActions {
  hooks: { exaSearchCard: SnapshotStore<ExaSearchCardState> }
  setExa(enabled: boolean): void
  clearApiKey(): void
}
/** Host-owned forms used by this page. */
export interface ExaSearchCardScopes {
  web: SettingsFormScope<WebProviderSelection>
  provider: SettingsFormScope<ExaSearchSettings>
}

/** Owns form drafts and credential status for one mounted Exa page. */
export class ExaSearchCardController {
  private readonly provider: SettingsFormModel<ExaSearchSettings>
  private readonly selection: SettingsFormModel<WebProviderSelection>
  private readonly store: SnapshotStore<ExaSearchCardState>
  private readonly unsubscribe: (() => void)[]
  private credential = { configured: false, writable: false }
  private disposed = false
  private credentialRevision = 0
  private credentialFailed = false
  private keyRemoving = false
  private keyRemovalFailed = false

  /**
   * @param scopes - served configuration forms.
   * @param ctx - credential RPC context.
   */
  constructor(private readonly scopes: ExaSearchCardScopes, private readonly ctx: Context) {
    this.provider = new SettingsFormModel(scopes.provider, [{ ...settingsNumberField('maxResults'), parse: (text) => {
      if (text.trim() === '') return { kind: 'clear' }
      const value = Number(text)
      return Number.isInteger(value) && value >= 1 && value <= 100 ? { kind: 'set', value } : undefined
    } }])
    this.selection = new SettingsFormModel(scopes.web, [settingsTextField('searchProvider')], [{
      field: 'apiKey', write: async (value) => {
        const result = await this.ctx.remote.credentials.set('EXA_API_KEY', value)
        if (!result.ok) return false
        await this.readCredential()
        return !this.credentialFailed && this.credential.configured
      },
    }])
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = [this.provider, this.selection].map(form => form.bind(() => form.shell()).subscribe(() => { this.publish() }))
    void this.readCredential()
  }

  private publish(): void { if (!this.disposed) this.store.set(this.projection()) }

  private projection(): ExaSearchCardState {
    const provider = this.provider.shell()
    const selection = this.selection.shell()
    return {
      available: provider.available,
      writable: [provider, selection].filter(form => form.available).every(form => form.writable),
      dirty: provider.dirty || selection.dirty,
      invalid: provider.invalid || selection.invalid,
      saving: provider.saving || selection.saving || this.keyRemoving,
      failed: provider.failed || selection.failed || this.credentialFailed || this.keyRemovalFailed,
      switchAvailable: provider.available && selection.available,
      useExa: this.selection.field('searchProvider').text === 'exa',
      maxResults: this.provider.field('maxResults'), apiKey: this.selection.field('apiKey'),
      apiKeyConfigured: this.credential.configured, apiKeyWritable: this.credential.writable,
    }
  }

  private async readCredential(): Promise<void> {
    const revision = ++this.credentialRevision
    try {
      const result = await this.ctx.remote.credentials.describe(['EXA_API_KEY'])
      if (this.disposed || revision !== this.credentialRevision) return
      this.credentialFailed = !result.ok
      if (result.ok) {
        const credential = result.value['EXA_API_KEY']
        this.credential = { configured: credential?.configured ?? false, writable: credential?.writable ?? false }
      }
    } catch {
      if (this.disposed || revision !== this.credentialRevision) return
      this.credentialFailed = true
    }
    this.publish()
  }

  /**
   * Refresh credential presence without exposing its stored value.
   * @param ref - changed credential reference.
   */
  refreshCredential(ref: string): void { if (ref === 'EXA_API_KEY') void this.readCredential() }

  /**
   * Bind the settings card to its staged actions and current state.
   * @returns page actions and snapshot binding.
   */
  inject(): ExaSearchCardFace {
    return {
      hooks: { exaSearchCard: this.store },
      clearApiKey: () => { void this.clearApiKey() },
      setExa: (enabled) => {
        const composed = (this.scopes.web.getSnapshot().base as WebProviderSelection | undefined)?.searchProvider
        const selection = this.selection.actions()
        if (enabled && composed !== 'exa') selection.edit('searchProvider', 'exa')
        else if (!enabled && composed === 'exa') selection.edit('searchProvider', 'deepseek-search-api')
        else selection.resetField('searchProvider')
      },
      edit: (field, text) => {
        if (field === 'apiKey') this.selection.actions().edit(field, text)
        else this.provider.actions().edit(field, text)
      },
      resetField: (field) => { this.provider.actions().resetField(field) },
      save: () => { void this.save() },
      discard: () => { this.provider.actions().discard(); this.selection.actions().discard() },
    }
  }

  private async clearApiKey(): Promise<void> {
    if (!this.credential.writable || this.projection().saving) return
    this.keyRemoving = true
    this.keyRemovalFailed = false
    this.publish()
    try {
      const result = await this.ctx.remote.credentials.unset('EXA_API_KEY')
      this.keyRemovalFailed = !result.ok
      if (result.ok) {
        this.selection.actions().edit('apiKey', '')
        await this.readCredential()
      }
    } catch {
      this.keyRemovalFailed = true
    } finally {
      this.keyRemoving = false
      this.publish()
    }
  }

  private async save(): Promise<void> {
    const state = this.projection()
    if (state.invalid || state.saving) return
    if (this.provider.shell().dirty) {
      await this.provider.save()
      if (this.provider.shell().failed) return
    }
    if (this.selection.shell().dirty) await this.selection.save()
  }

  /** Release form subscriptions and ignore late credential reads. */
  dispose(): void {
    this.disposed = true
    for (const off of this.unsubscribe) off()
    this.provider.dispose(); this.selection.dispose()
  }
}
