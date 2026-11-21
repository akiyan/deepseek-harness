/** akiyan plugin settings control for automatic next-message suggestions. */
import { useId, useState } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './EnterBehaviorRow.module.css'

/** The Host setting the composer uses to admit auxiliary requests. */
export interface PromptSuggestionSettings {
  readonly promptSuggestionsEnabled: boolean
}

/** Preferences and accepted writes shared with the composer. */
export interface PromptSuggestionRowInjected {
  hooks: { suggestionSettings: ObservableSnapshot<ConfigFormSnapshot<PromptSuggestionSettings>> }
  setEnabled: (enabled: boolean) => Promise<boolean>
}

type Props = PropsRuntime<'plugins.akiyan'> & PropsLocale<'settings.promptSuggestion'> & InjectFace<PromptSuggestionRowInjected>

/**
 * Render the card summary or the immediate-save setting on its detail page.
 * @param props - Plugin view, settings form, writer, and localized text.
 * @returns the summary or the switch with its data-use explanation.
 */
export function PromptSuggestionRow({ view, useSuggestionSettings, setEnabled, t }: Props) {
  const settings = useSuggestionSettings(value => value)
  const [write, setWrite] = useState<'idle' | 'saving' | 'failed'>('idle')
  const details = useId()
  if (view === 'summary') return t('summary')
  if (settings.status === 'unavailable') return null
  const label = t('toggle')
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{label}</div>
        <div id={details} className={css.suggestionDesc}>{t('description')}</div>
        {write === 'failed' && <div className={css.suggestionDesc} role="alert">{t('saveFailed')}</div>}
      </div>
      <Switch label={label} describedBy={details}
        checked={settings.value?.promptSuggestionsEnabled === true}
        disabled={settings.status !== 'ready' || !settings.writable}
        busy={write === 'saving'}
        onChange={(enabled) => {
          setWrite('saving')
          void setEnabled(enabled).then(
            (accepted) => { setWrite(accepted ? 'idle' : 'failed') },
            () => { setWrite('failed') },
          )
        }} />
    </div>
  )
}
