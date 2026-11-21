/** Human-authored prompt text in the Session's loaded history window. */
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'

/** Stable message identity and reusable text, excluding image payloads. */
export interface PromptHistoryItem {
  readonly id: MessageId
  readonly text: string
}

/**
 * Read chronological human prompts without recalling automatic user-role inputs.
 * @param source - the Session-owned event window.
 * @returns prompts containing reusable text.
 */
export function readPromptHistory(source: SessionEventSource): readonly PromptHistoryItem[] {
  return source.getSnapshot().entries.flatMap(({ event }) => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return []
    const text = event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
    return text.trim() === '' ? [] : [{ id: event.data.id, text }]
  })
}
