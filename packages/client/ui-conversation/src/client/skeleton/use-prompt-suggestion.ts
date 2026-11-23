/** Local lifetime of a follow-up preview in the mounted composer. */
import { useEffect, useState } from 'react'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ComposerBarProps, InputBarInjected } from '../contract/slots.ts'
import { DRAFT_SUBMITTED_TAG } from '../input/editor/runtime.ts'

type TurnMarker = SessionSeq | null | undefined

interface SuggestionSeat {
  readonly keyboard: NonNullable<ComposerBarProps['keyboard']>
  readonly actions: NonNullable<ComposerBarProps['inputActions']>
  readonly request: NonNullable<InputBarInjected['requestPromptSuggestion']>
  readonly draftRev: number
  readonly ready: boolean
  readonly isTriggerMenuOpen: InputBarInjected['isPromptTriggerMenuOpen']
}

interface Offer extends SuggestionSeat {
  readonly turn: SessionSeq
}

type OfferState =
  | { readonly kind: 'waiting' | 'requesting'; readonly target: Offer }
  | { readonly kind: 'visible' | 'adopted'; readonly target: Offer; readonly text: string }

interface Observation {
  readonly sessionId: SessionId | undefined
  readonly marker: TurnMarker
  readonly offer: OfferState | null
}

function observe(
  previous: Observation,
  sessionId: SessionId | undefined,
  marker: TurnMarker,
  seat: SuggestionSeat | null,
  running: boolean,
): Observation {
  if (previous.sessionId !== sessionId) return { sessionId, marker, offer: null }
  if (previous.marker !== marker) {
    // undefined means no ready baseline. A null baseline (no eligible turn) still counts.
    const offer = previous.marker === undefined || marker == null || seat?.ready !== true
      ? null
      : { kind: running ? 'waiting' as const : 'requesting' as const, target: { ...seat, turn: marker } }
    return { sessionId, marker, offer }
  }
  const offer = previous.offer
  if (offer === null) return previous
  const { target } = offer
  // The turn-end frame can precede idle. Once requested, becoming busy again retires the offer.
  if (seat === null || seat.keyboard !== target.keyboard || seat.request !== target.request
    || (running && offer.kind !== 'waiting')) return { ...previous, offer: null }
  // A draft edit supersedes an untouched offer. An adopted one stays available
  // for the same turn without needing the old draft revision or another request.
  if (offer.kind === 'adopted') return previous
  if (!seat.ready || seat.draftRev !== target.draftRev) return { ...previous, offer: null }
  if (!running && offer.kind === 'waiting') return { ...previous, offer: { kind: 'requesting', target } }
  return previous
}

function canUseOffer({ keyboard, draftRev, isTriggerMenuOpen }: SuggestionSeat): boolean {
  const input = keyboard.snapshot
  return input.phase === 'plain' && input.draft === '' && input.draftRev === draftRev
    && input.attachmentIds.length === 0 && input.queue.length === 0 && keyboard.isRecallingPrompt?.() !== true
    && isTriggerMenuOpen?.() !== true && !keyboard.editor.isComposing()
    && keyboard.editor.getRootElement()?.hasAttribute('data-composer-composing') !== true
}

/**
 * Request at most one suggestion for a newly observed completion. An adopted
 * suggestion can be offered again if its unsent draft is cleared.
 * @param sessionId - composer Session identity; changing it starts a new baseline.
 * @param marker - undefined before a ready projection, null without an eligible completion, or the turn-end sequence.
 * @param seat - current draft revision and readiness; null when this composer cannot retain an offer.
 * @param running - whether the Session still reports work in progress.
 * @returns the preview text, an undoable insert gesture, and a discard gesture that reports whether a preview was visible.
 */
export function usePromptSuggestion(
  sessionId: SessionId | undefined,
  marker: TurnMarker,
  seat: SuggestionSeat | null,
  running: boolean,
): { text: string | null; discard: () => boolean; accept: () => boolean } {
  const [stored, setStored] = useState<Observation>(() => ({ sessionId, marker, offer: null }))
  const current = observe(stored, sessionId, marker, seat, running)
  if (current !== stored) setStored(current)

  const editor = seat?.keyboard.editor
  useEffect(() => editor?.registerUpdateListener(({ tags }) => {
    // An accepted send can clear the editor before React ever sees a busy frame.
    if (!tags.has(DRAFT_SUBMITTED_TAG)) return
    setStored(previous => previous.offer?.kind === 'adopted' && previous.offer.target.keyboard.editor === editor
      ? { ...previous, offer: null } : previous)
  }), [editor])

  const pending = current.offer?.kind === 'requesting' ? current.offer.target : null
  useEffect(() => {
    if (pending === null) return
    const controller = new AbortController()
    const load = async (): Promise<string | null> => {
      if (!canUseOffer(pending)) return null
      try {
        return await pending.request(pending.turn, controller.signal)
      } catch {
        // A failed optional preview must not interrupt composing.
        return null
      }
    }
    void load().then((text) => {
      if (controller.signal.aborted) return
      const offer = text !== null && text.trim() !== '' && canUseOffer(pending)
        ? { kind: 'visible' as const, target: pending, text }
        : null
      setStored(previous => previous.offer?.target === pending ? { ...previous, offer } : previous)
    })
    return () => { controller.abort() }
  }, [pending])

  const offer = current.offer
  // The next render must see a draft edit before it can offer the same text
  // again: a Tab insertion may commit with the surrounding Lexical update.
  const preview = offer?.kind === 'visible' || (offer?.kind === 'adopted' && seat?.ready === true
    && seat.draftRev !== offer.target.draftRev) ? offer : null
  const discard = (): boolean => {
    // Escape, history and composition must not discard an unseen adopted offer.
    if (offer === null || (offer.kind === 'adopted' && preview === null)) return false
    setStored(previous => previous.offer?.target === offer.target ? { ...previous, offer: null } : previous)
    return preview !== null
  }
  const accept = (): boolean => {
    if (preview === null || seat === null || !canUseOffer(seat)) return false
    const { actions, draftRev } = seat
    const span = actions.captureInsertion()
    if (span.draftRev !== draftRev || !actions.insertText(preview.text, span)) return false
    const adopted: OfferState = { kind: 'adopted', target: { ...seat, turn: preview.target.turn }, text: preview.text }
    setStored(previous => previous.offer === preview ? { ...previous, offer: adopted } : previous)
    return true
  }
  return { text: preview?.text ?? null, discard, accept }
}
