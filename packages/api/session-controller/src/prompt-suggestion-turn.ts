/** Bounded, text-only input for a suggestion, folded from the latest completed turn. */

import { Buffer } from 'node:buffer'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

const PROMPT_EXCERPT_LIMIT = 1_024
const ANSWER_EXCERPT_LIMIT = 2_048
const CONTENT_BLOCK_LIMIT = 32
const SECRET_LOOKAHEAD = 64
const SECRET_MARKERS = [
  /-----BEGIN [\w -]{0,40}PRIVATE KEY-----/iu,
  /\b(?:api[ _-]?key|(?:(?:access|auth|refresh)[ _-]?)?token|password|secret)\s*["']?\s*[:=]/iu,
  /\bbearer\s+[\w.+/-]{6}|:\/\/[^\s/@:]+:[^\s/@]+@/iu,
  /\b(?:sk[-_]|gh[pousr]_|github_pat_|xox[baprs]-|AKIA)[a-z0-9_-]{6}/iu,
  /\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6}/u,
]

const seqSchema = z.number().int().nonnegative().transform(value => SessionSeq(value))
const answerSchema = z.object({
  text: z.string().min(4).max(ANSWER_EXCERPT_LIMIT),
  provider: z.string().min(1),
  model: z.string().min(1),
})
const promptSchema = z.string().min(1).max(PROMPT_EXCERPT_LIMIT)
const stateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('disabled') }),
  z.object({ kind: z.literal('ineligible') }),
  z.object({
    kind: z.literal('open'),
    turn: z.number().int().positive(),
    openingStep: z.number().int().positive().nullable(),
    step: z.number().int().positive().nullable(),
    prompt: promptSchema.nullable(),
    answer: answerSchema.nullable(),
  }),
  z.object({ kind: z.literal('eligible'), turnEndSeq: seqSchema, prompt: promptSchema, answer: answerSchema }),
])

type PromptSuggestionTurn = z.infer<typeof stateSchema>

/** Host-only sanitized input and exact end cursor for an eligible turn. */
export type EligibleSuggestionTurn = Extract<PromptSuggestionTurn, { kind: 'eligible' }>

const INELIGIBLE = { kind: 'ineligible' } as const

/**
 * Reject explicit credential markers before copying conversation excerpts into an auxiliary call.
 * @param text - bounded input or output to check.
 * @returns whether one of the recognized markers is present; this is not a general secret detector.
 */
export function hasSuggestionSecretMarker(text: string): boolean {
  return SECRET_MARKERS.some(marker => marker.test(text))
}

/**
 * Recognize a direct human prompt from the owner or a trusted in-process producer.
 * @param message - admitted or queued input whose source identifies its producer.
 * @returns whether the prompt is human-origin and has no non-owner principal.
 */
export function isSuggestionHumanPrompt(message: UserMessage): boolean {
  return message.source.kind === 'user' && !('principal' in message.source)
}

function excerpt(content: readonly ContentBlock[], limit: number, isAnswer: boolean): string | null {
  let text = ''
  for (const block of content.slice(0, CONTENT_BLOCK_LIMIT)) {
    if (block.type !== 'text') continue
    if (text !== '') text += '\n'
    text += block.text.slice(0, limit + SECRET_LOOKAHEAD - text.length)
    if (text.length >= limit + SECRET_LOOKAHEAD) break
  }
  if (hasSuggestionSecretMarker(text)) return null
  const fence = isAnswer ? text.search(/^[ \t]*(?:```|~~~)/m) : -1
  const bounded = text.slice(0, fence === -1 ? limit : Math.min(limit, fence)).trim().toWellFormed()
  if (bounded.length < (isAnswer ? 4 : 1) || !/[\p{L}\p{N}]/u.test(bounded)) return null
  // A checkpoint or live projection must not retain the original large string through a slice.
  return Buffer.from(bounded, 'utf16le').toString('utf16le')
}

function fold(state: PromptSuggestionTurn, event: SessionEvent): PromptSuggestionTurn {
  if (state.kind === 'disabled') return state
  switch (event.type) {
    case 'session/end-seed':
      return INELIGIBLE
    case 'turn/start':
      return { kind: 'open', turn: event.data.turn, openingStep: null, step: null, prompt: null, answer: null }
    case 'step/start':
      if (state.kind !== 'open' || state.turn !== event.data.turn) return state
      return { ...state, openingStep: state.openingStep ?? event.data.step, step: event.data.step, answer: null }
    case 'user/message': {
      if (state.kind !== 'open' || state.step === null || state.step !== state.openingStep
        || state.prompt !== null || event.surfaceOp !== 'append' || !isSuggestionHumanPrompt(event.data)) return state
      const prompt = excerpt(event.data.content, PROMPT_EXCERPT_LIMIT, false)
      return prompt === null ? state : { ...state, prompt }
    }
    case 'assistant/message': {
      if (state.kind !== 'open' || state.turn !== event.data.turn || state.step !== event.data.step
        || event.surfaceOp !== 'append') return state
      const { message, interrupted } = event.data
      const { provider, model } = message.source
      const text = interrupted === true || provider.length === 0 || model.length === 0
        || message.content.some(block => block.type === 'tool-call')
        ? null : excerpt(message.content, ANSWER_EXCERPT_LIMIT, true)
      return { ...state, answer: text === null ? null : { provider, model, text } }
    }
    case 'step/end':
      if (state.kind !== 'open' || state.turn !== event.data.turn || state.step !== event.data.step) return state
      return { ...state, step: null }
    case 'turn/end':
      if (state.kind !== 'open' || state.turn !== event.data.turn || state.step !== null
        || event.data.reason.kind !== 'completed' || state.prompt === null || state.answer === null) return INELIGIBLE
      return { kind: 'eligible', turnEndSeq: event.seq, prompt: state.prompt, answer: state.answer }
    default:
      return state
  }
}

/** Publish only the completed turn's exact sequence, never its private input excerpts. */
export const promptSuggestionTurnProjection = {
  key: 'promptSuggestionTurn',
  stateSchema,
  init: header => header.cwd === undefined || header.origin === 'subagent' ? { kind: 'disabled' } : INELIGIBLE,
  apply: fold,
  stateVersion: 1,
  wire: { viewSchema: seqSchema.nullable(), view: state => state.kind === 'eligible' ? state.turnEndSeq : null, summary: false },
} satisfies ProjectionDefinition<'promptSuggestionTurn', PromptSuggestionTurn>
