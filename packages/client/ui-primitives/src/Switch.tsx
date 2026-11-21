// Switch: two-state toggle. `label` is required and has no default, so a render
// site cannot ship the control without an accessible name.

import clsx from 'clsx'
import css from './Switch.module.css'

/**
 * Render a toggle switch.
 * @param props.checked - the current state; the control is fully controlled.
 * @param props.onChange - called with the state the click asks for.
 * @param props.label - localized accessible name, owned by the render site.
 * @param props.disabled - whether the control is unavailable for interaction.
 * @param props.busy - temporarily refuse activation without moving keyboard focus.
 * @param props.title - localized hover text, typically why the toggle is locked.
 * @param props.className - extra class for layout placement.
 * @param props.autoFocus - whether the control takes focus when it mounts enabled.
 * @param props.describedBy - id of the element that describes the control.
 * @returns the switch element.
 */
export function Switch({ checked, onChange, label, disabled = false, busy = false, title, className, autoFocus, describedBy }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  busy?: boolean
  title?: string | undefined
  // `| undefined` so a caller can forward an optional class straight through
  // under exactOptionalPropertyTypes (a CSS-module lookup is string|undefined).
  className?: string | undefined
  autoFocus?: boolean
  describedBy?: string | undefined
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      title={title}
      disabled={disabled}
      autoFocus={autoFocus}
      className={clsx(css.switch, className)}
      onClick={() => { if (!busy) onChange(!checked) }}
    >
      <span className={css.thumb} />
    </button>
  )
}
