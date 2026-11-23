import { describe, expect, it } from 'vitest'
import type { SessionFormatArtifact, SessionFormatEvent } from '@deepseek-ai/dsh-session-format'
import { restoreReleasedV4Artifact } from '../src/index.ts'

const header = { version: 4, id: 'open-vocabulary', createdAt: 1, delegationDepth: 0, isSeeded: false }
function artifact(events: readonly { type: string; data: unknown; ignorable?: true; surfaceOp?: unknown }[]): SessionFormatArtifact {
  return { header, inheritedEventCount: 0, events: events.map((event, seq) => ({ ...event, seq, time: seq })) as SessionFormatEvent[] }
}

describe('known V4 event interpretation', () => {
  it('keeps unknown ignorable payloads and coordinates opaque to every native semantic pass', () => {
    const unknown = ['tool/result', 'system/message', 'request/header', 'session/title-llm-request', 'subagent/catalog', 'session-log-deepseek/delivery-accepted', 'compaction/start', 'compaction/end', 'session/end-seed'].map(type => ({ type, data: null, ignorable: true as const }))
    const input = artifact([...unknown, { type: 'turn/start', data: { turn: 1 } }, { type: 'turn/end', data: { turn: 1 } }])
    const before = JSON.stringify(input)
    expect(restoreReleasedV4Artifact(input, new Set(['turn/start', 'turn/end']))).toBe(input)
    expect(JSON.stringify(input)).toBe(before)
    expect(input.events.at(-1)?.seq).toBe(unknown.length + 1)
  })

  it('preserves a prompt suggestion audit as a log-only row on both sides of a reader upgrade', () => {
    const audit = {
      type: 'session/prompt-suggestion-request',
      data: { turnEndSeq: 1, route: { provider: 'p', model: 'm' }, system: 'instruction', input: 'exchange', maxTokens: 112 },
    }
    const prefix = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const suffix = [
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
    ]
    const log = artifact([...prefix, { ...audit, ignorable: true }, ...suffix])
    const older = new Set(['turn/start', 'turn/end'])
    const current = new Set([...older, audit.type])
    expect(restoreReleasedV4Artifact(log, older).events).toEqual(log.events)
    expect(restoreReleasedV4Artifact(log, current).events).toEqual(log.events)
    expect(restoreReleasedV4Artifact(artifact([...prefix, ...suffix]), current).events).toHaveLength(4)
    expect(() => restoreReleasedV4Artifact(artifact([...prefix, audit, ...suffix]), older)).toThrow(/unknown event type/)
  })

  it('does not let an opaque end-seed clear an owned compaction', () => {
    const input = artifact([
      { type: 'compaction/start', data: { compactionId: 'owner', turn: null } },
      { type: 'session/end-seed', data: {}, ignorable: true },
      { type: 'turn/start', data: { turn: 1 } },
    ])
    expect(() => restoreReleasedV4Artifact(input, new Set(['compaction/start', 'turn/start']))).toThrow(/crosses an open compaction/)
  })

  it('does not reinterpret an unknown ignorable user row through a known title citation', () => {
    const input = artifact([
      { type: 'user/message', data: null, ignorable: true },
      { type: 'session/title', data: { title: 'title', source: { kind: 'generated' }, messageSeqs: [0] } },
    ])
    expect(() => restoreReleasedV4Artifact(input, new Set(['session/title']))).toThrow(/earlier human user\/message/)
  })

  it('still validates known events marked ignorable', () => {
    const input = artifact([{ type: 'tool/result', data: null, ignorable: true }])
    expect(() => restoreReleasedV4Artifact(input, new Set(['tool/result']))).toThrow(/data must be an object/)
  })

  it('still validates unknown envelopes and refuses unknown required types', () => {
    const required = artifact([{ type: 'external/event', data: null }])
    expect(() => restoreReleasedV4Artifact(required, new Set())).toThrow(/unknown event type/)
    const input = artifact([{ type: 'external/event', data: null, ignorable: true }])
    expect(() => restoreReleasedV4Artifact({ ...input, events: [{ ...input.events[0]!, seq: 3 }] }, new Set())).toThrow(/not dense/)
  })
})
