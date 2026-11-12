/** Exa settings composed from the shared settings form controls. */
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { Button, SettingsForm, SettingsSecretField, SettingsValueField, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from './locales.ts'
import type { ExaSearchCardFace } from './exa-search-card-controller.ts'
import css from './ExaSearchCard.module.css'

/** Props supplied by the settings slot. */
export type ExaSearchCardProps = PropsRuntime<'plugins.item'> & PropsLocale<'settings.webSearchExa'> & InjectFace<ExaSearchCardFace>

/**
 * Render the summary or settings form for Exa search.
 * @param props - locale, page view, and staged form actions.
 * @returns the provider settings card.
 */
export function ExaSearchCard(props: ExaSearchCardProps) {
  const { t } = props
  const state = props.useExaSearchCard(snapshot => snapshot)
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable || state.saving
  return <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
    {state.switchAvailable ? <div className={css.feature}>
      <label className={css.toggleRow}><span>{t('useExa')}</span>
        <Switch checked={state.useExa} label={t('useExa')} disabled={disabled} onChange={props.setExa} />
      </label><p className={css.hint}>{t('useExaHint')}</p>
    </div> : null}
    <SettingsSecretField id="plugin-config-exa-key" label={t('apiKey')} hint={t('apiKeyHint')}
      text={state.apiKey.text} configured={state.apiKeyConfigured}
      stateLabel={t(state.apiKeyConfigured ? 'keyConfigured' : 'keyAnonymous')}
      disabled={disabled || !state.apiKeyWritable} onEdit={(text) => { props.edit('apiKey', text) }} />
    {state.apiKeyConfigured && state.apiKeyWritable ? <Button variant="outline" disabled={state.saving}
      onClick={props.clearApiKey}>{t('removeKey')}</Button> : null}
    <SettingsValueField id="plugin-config-exa-count" label={t('maxResults')} hint={t('maxResultsHint')}
      overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')} numeric disabled={disabled}
      {...state.maxResults} onEdit={(text) => { props.edit('maxResults', text) }} onReset={() => { props.resetField('maxResults') }} />
  </SettingsForm>
}
