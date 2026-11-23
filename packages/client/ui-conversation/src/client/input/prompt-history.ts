/** Human-authored prompt text in the Session's loaded history window. */
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/** A group of consecutive identical human prompts, identified by its log sequence span. */
export interface LoadedPrompt {
  readonly text: string
  readonly newest: SessionSeq
  oldest: SessionSeq
}

/**
 * Read human prompts as joined text blocks, skipping empty text and folding consecutive repeats.
 * @param entries - the loaded Session events, oldest first.
 * @returns recallable prompts, newest first.
 */
export function loadedPrompts(entries: readonly SessionEventLikeEntry[]): readonly LoadedPrompt[] {
  const prompts: LoadedPrompt[] = []
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry?.type !== 'event' || entry.event.type !== 'user/message' || entry.event.data.source.kind !== 'user') continue
    const text = entry.event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
    if (text.trim() === '') continue
    const last = prompts.at(-1)
    if (last?.text === text) last.oldest = entry.event.seq
    else prompts.push({ text, newest: entry.event.seq, oldest: entry.event.seq })
  }
  return prompts
}

/**
 * Find the group that contains the selected log position, even after overlapping duplicates are loaded.
 * @param prompts - the current loaded prompts.
 * @param seq - sequence of the selected prompt.
 * @returns its group index, or -1 if it is no longer loaded.
 */
export function promptIndex(prompts: readonly LoadedPrompt[], seq: SessionSeq): number {
  return prompts.findIndex(prompt => prompt.oldest <= seq && seq <= prompt.newest)
}
