/** ChatGPT account controls within Models settings. */
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import { flushSync } from 'react-dom'
import type { ChatGPTView, ChatGPTAction } from './chatgpt.ts'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

interface CardActions {
  busy: boolean
  act: (action: ChatGPTAction) => Promise<void>
  t: (key: ModelsKey) => string
}

/**
 * Render account details and browser sign-in actions.
 * @param props - safe Host state and explicit account actions.
 * @returns OAuth-only provider controls.
 */
export function ChatGPTCard({ view, busy, error, hideTitle, onClose, browserOpened, act, t }: {
  view: ChatGPTView
  error?: string
  hideTitle?: boolean
  onClose?: () => void
  browserOpened?: boolean
} & CardActions) {
  const [confirmStart, setConfirmStart] = useState<ChatGPTAction>()
  const [opening, setOpening] = useState(false)
  const returnInput = useRef<HTMLInputElement>(null)
  const start = (action: ChatGPTAction): void => {
    if (isRemotePage()) setConfirmStart(action)
    else void act(action)
  }
  const selected = view.accounts.find(account => account.id === view.active && account.connected)
  return <section className={styles['editor']} aria-label={t('chatgptTitle')}>
    {hideTitle ? null : <h3 className={`${styles['editorTitle']} ${styles['chatgptTitle']}`}>{t('chatgptTitle')}</h3>}
    {view.pending || opening ? null : <p className={styles['intro']}>{t(selected?.connected && selected.sharing ? 'chatgptUsingPlan' : 'chatgptDescription')}</p>}
    {view.pending || opening || selected === undefined ? null : <div className={styles['field']}>
      <span>{t('chatgptAccount')}</span>
      <span className={styles['chatgptAccountLabel']}>{selected.label}</span>
      <div className={styles['chatgptActions']}><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">{t('chatgptManageUsage')}</a></div>
    </div>}
    {view.pending || opening ? <ChatGPTPending inputRef={returnInput} preparing={opening} authorizeUrl={view.authorizeUrl} browserOpened={browserOpened === true} busy={busy} act={act} t={t} /> : <div className={`${styles['editorActions']} ${styles['chatgptActions']}`}>
      {onClose === undefined ? null : <Button variant="outline" disabled={busy} onClick={onClose}>{t('cancel')}</Button>}
      {selected?.connected !== true ? null : <Button variant="outline" disabled={busy}
        onClick={() => { start({ action: 'start', id: selected.id }) }}>{t('chatgptReconnect')}</Button>}
      {selected !== undefined ? null : <Button variant="primary" disabled={busy}
        onClick={() => { start({ action: 'start' }) }}>{t('chatgptContinue')}</Button>}
      {selected?.connected !== true ? null : <Button variant="outline" disabled={busy} onClick={() => { void act({ action: 'logout', id: selected.id }) }}>{t('chatgptSignOut')}</Button>}
    </div>}
    {error === undefined && view.error === undefined ? null : <p role="alert" className={styles['error']}>{error ?? view.error}</p>}
    <Modal open={confirmStart !== undefined} onClose={() => { setConfirmStart(undefined) }}
      title={t('chatgptBeforeOpening')} closeLabel={t('close')} description={t('chatgptCopyInstructions')}
      footer={<>
        <Button variant="outline" onClick={() => { setConfirmStart(undefined) }}>{t('cancel')}</Button>
        <Button variant="primary" data-modal-autofocus disabled={busy} onClick={() => {
          const action = confirmStart
          if (action === undefined) return
          // Commit the form and modal dismissal before the gesture opens another tab.
          flushSync(() => { setConfirmStart(undefined); setOpening(true) })
          returnInput.current?.focus()
          void act(action).finally(() => { setOpening(false) })
        }}>{t('chatgptConfirmOpen')}</Button>
      </>} />
  </section>
}

/** Keeps a pasted authorization code only while its pending form is mounted. */
function ChatGPTReturnForm({ busy, act, t, inputRef }: CardActions & { inputRef: RefObject<HTMLInputElement> }) {
  const [callback, setCallback] = useState('')
  return <form className={styles['field']} onSubmit={(event) => {
    event.preventDefault()
    const url = callback.trim()
    if (!url || busy) return
    setCallback('')
    void act({ action: 'complete', url })
  }}>
    <p className={styles['intro']}>{t('chatgptRemoteHelp')}</p>
    <label className={styles['field']}>
      <span>{t('chatgptReturnUrl')}</span>
      <input ref={inputRef} className={`${styles['input']} ${styles['chatgptInput']}`} type="text" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        value={callback} readOnly={busy} maxLength={3500} onChange={(event) => { setCallback(event.target.value) }} />
    </label>
    <div className={`${styles['editorActions']} ${styles['chatgptActions']}`}>
      <Button variant="outline" disabled={busy} onClick={() => { void act({ action: 'cancel' }) }}>{t('cancel')}</Button>
      <Button type="submit" variant="primary" disabled={busy || !callback.trim()}>{t('chatgptComplete')}</Button>
    </div>
  </form>
}

/** Each pending attempt reveals remote completion only after its browser link is activated. */
function ChatGPTPending({ authorizeUrl, browserOpened, preparing, inputRef, busy, act, t }: CardActions & {
  preparing: boolean
  inputRef: RefObject<HTMLInputElement>
  authorizeUrl: string | undefined
  browserOpened: boolean
}) {
  const [opened, setOpened] = useState(false)
  const remote = isRemotePage()
  const hasOpened = browserOpened || opened
  return <>
    {hasOpened ? <p role="status">{t('chatgptBrowserOpened')}</p> : null}
    {authorizeUrl === undefined ? null : <div className={styles['chatgptActions']}>
      <a href={authorizeUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
        onClick={() => {
          flushSync(() => { setOpened(true) })
          inputRef.current?.focus()
        }}>{t(hasOpened ? 'chatgptReopenBrowser' : 'chatgptOpenBrowser')}</a>
    </div>}
    {remote && (hasOpened || preparing) ? <ChatGPTReturnForm inputRef={inputRef} busy={busy} act={act} t={t} /> : <>
      {hasOpened ? <p className={styles['intro']}>{t('chatgptLocalWaiting')}</p> : null}
      <div className={styles['editorActions']}>
        <Button variant="outline" disabled={busy} onClick={() => { void act({ action: 'cancel' }) }}>{t('cancel')}</Button>
      </div>
    </>}
  </>
}

/** Remote browsers cannot reach the Host's loopback OAuth callback. */
function isRemotePage(): boolean {
  return !['127.0.0.1', 'localhost', '[::1]'].includes(globalThis.location.hostname)
}
