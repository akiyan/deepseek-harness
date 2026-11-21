/** Stateless text-area presentation over the InputBar's borrowed editor. */
import { useId } from 'react'
import type { CSSProperties, KeyboardEventHandler, ReactNode, RefObject } from 'react'
import type { LexicalEditor } from 'lexical'
import clsx from 'clsx'
import { HoverCardGroup } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputState } from '../../contract/input.ts'
import { ComposerContentEditable } from './ComposerContentEditable.tsx'
import { DecoratorPortals } from './DecoratorPortals.tsx'

/** Text-area values and the scrollport reference retained by InputBar. */
export interface DraftEditorProps {
  readonly classNames: Readonly<Record<string, string>>
  readonly editor: LexicalEditor | null
  readonly scrollRef: RefObject<HTMLDivElement>
  readonly editable: boolean
  readonly editorDisabled: boolean
  readonly phase: InputState['phase'] | 'inert'
  readonly placeholderText: string
  readonly ariaLabel: string
  readonly workspaceTrigger: boolean
  readonly workspacePickerOpen: boolean
  readonly onWorkspaceKeyDown: KeyboardEventHandler<HTMLDivElement>
  readonly hint: string | null
  readonly showPlaceholder: boolean
  readonly suggestion?: {
    readonly text: string
    readonly label: string
    readonly tab: string
    readonly tap: string
    readonly announce: string
    readonly onAccept: () => void
    readonly onDismiss: () => boolean
  } | null
}

/**
 * Render the scrollport, editable surface, placeholder or suggestion, and chip portals.
 * @param props - borrowed editor and presentation values.
 * @returns the text-area DOM without an additional wrapper.
 */
export function DraftEditor({
  classNames: css, editor, scrollRef, editable, editorDisabled, phase, placeholderText, ariaLabel,
  workspaceTrigger, workspacePickerOpen, onWorkspaceKeyDown, hint, showPlaceholder, suggestion = null,
}: DraftEditorProps): ReactNode {
  const suggestionId = useId()
  return (
    <div ref={scrollRef} className={css.scroll} data-input-scroll>
      <HoverCardGroup className={clsx(css.grow, suggestion !== null && css.growWithSuggestion)}>
        <ComposerContentEditable
          editor={workspaceTrigger ? null : editor}
          editable={editable}
          className={clsx(css.input, editorDisabled && css.inputDisabled)}
          data-phase={phase}
          aria-disabled={editorDisabled || undefined}
          data-placeholder={placeholderText}
          // The placeholder was the textarea's accessible name; a div's
          // data attribute is not, so the label restores it.
          aria-label={ariaLabel}
          aria-describedby={suggestion === null ? undefined : suggestionId}
          aria-haspopup={workspaceTrigger ? 'menu' : undefined}
          aria-expanded={workspaceTrigger ? workspacePickerOpen : undefined}
          tabIndex={workspaceTrigger ? 0 : undefined}
          onKeyDown={workspaceTrigger ? onWorkspaceKeyDown : undefined}
          style={hint === null ? undefined : { '--dsh-composer-hint': JSON.stringify(hint) } as CSSProperties}
        />
        {suggestion !== null ? (
          <div className={css.suggestion} data-composer-prompt-suggestion>
            <span id={suggestionId} className={css.suggestionText}>{suggestion.text}</span>
            <button
              type="button"
              className={css.suggestionAction}
              aria-label={suggestion.label}
              aria-describedby={suggestionId}
              onClick={suggestion.onAccept}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing
                  && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && suggestion.onDismiss()) {
                  event.preventDefault()
                }
              }}
            >
              <kbd className={css.suggestionKey} aria-hidden>{suggestion.tab}</kbd>
              <span className={css.suggestionTap} aria-hidden>{suggestion.tap}</span>
            </button>
          </div>
        ) : showPlaceholder && (
          <div aria-hidden className={css.placeholder} data-composer-placeholder>
            {placeholderText}
          </div>
        )}
        <div className={css.suggestionStatus} aria-live="polite" aria-atomic="true">{suggestion?.announce}</div>
        <DecoratorPortals editor={workspaceTrigger ? null : editor} />
      </HoverCardGroup>
    </div>
  )
}
