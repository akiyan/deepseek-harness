import assert from 'node:assert/strict'
import test from 'node:test'
import { notificationCopy, previewText, replyPreview } from './notification-content.js'

const text = text => ({ type: 'text', text })

test('automatic copy carries a localized outcome, session title and useful extract', () => {
  assert.deepEqual(notificationCopy({ kind: 'completed', sessionTitle: '通知の文面', summary: '通知にセッション名を追加しました。' }, 'ja'), {
    title: '通知の文面', body: '通知にセッション名を追加しました。',
  })
  assert.deepEqual(notificationCopy({ kind: 'error', sessionTitle: 'Report draft' }, 'en'), {
    title: '[Error] Report draft', body: 'Your session ended with an error.',
  })
  assert.deepEqual(notificationCopy({ kind: 'completed' }, 'ja'), {
    title: 'DeepSeek Harness', body: 'セッションの応答が完了しました。',
  })
})

test('questions take priority and are labeled as requiring a response', () => {
  const sample = { sessionTitle: 'Plan', question: 'どちらにしますか？', summary: 'Several options are available.' }
  assert.deepEqual(notificationCopy({ ...sample, kind: 'question' }, 'ja'), {
    title: '[要回答] Plan', body: 'どちらにしますか？',
  })
  assert.deepEqual(notificationCopy({ ...sample, kind: 'followup' }, 'en'), {
    title: '[Response needed] Plan', body: 'どちらにしますか？',
  })
  assert.equal(notificationCopy({ ...sample, kind: 'followup' }, 'ja').title, '[要回答] Plan')
  assert.equal(notificationCopy({ kind: 'question', question: '```\nonly code\n```' }, 'en').body, 'Your session is waiting for an answer.')
})

test('manual message is literal, and test wording remains unchanged', () => {
  const note = '**Literal text** with `markup`.'
  assert.deepEqual(notificationCopy({ kind: 'manual', message: note, summary: 'ignore' }, 'ja'), {
    title: 'DeepSeek Harness', body: note,
  })
  assert.deepEqual(notificationCopy({ kind: 'test', message: 'ignore' }, 'ja'), {
    title: 'DeepSeek Harness', body: 'このブラウザで通知を受け取れます。',
  })
  assert.equal(notificationCopy({ kind: 'test' }, 'unknown').body, 'This browser can receive notifications.')
})

test('reply uses visible text, can identify a final question and ignores other content', () => {
  assert.deepEqual(replyPreview([
    { type: 'reasoning', text: 'Internal thought.' },
    { type: 'tool-call', name: 'bash', arguments: 'private output' },
    { type: 'file', attachment: { name: 'private.txt' } },
    { type: 'image', attachment: { name: 'private.png' } },
    text('対応しました。どちらを選びますか？'),
  ]), { summary: '対応しました。どちらを選びますか？', question: 'どちらを選びますか？' })
  assert.deepEqual(replyPreview([text('The draft is ready. Would you like revisions?')]), {
    summary: 'The draft is ready. Would you like revisions?', question: 'Would you like revisions?',
  })
  assert.deepEqual(replyPreview([text('Ready? The draft is ready.')]), { summary: 'Ready? The draft is ready.' })
  assert.deepEqual(replyPreview([{ type: 'reasoning', text: 'Internal thought.' }]), {})
})

test('automatic previews exclude common sensitive, code, log and attachment patterns', () => {
  const raw = [
    'The **draft** is ready.',
    '<think>internal\nthought</think>',
    '```sh',
    'private script',
    '```',
    '    indented code',
    'See [the notes](https://example.com/private?q=value).',
    'Also see https://example.com/?token=another-value',
    '![sensitive image title](images/private.png)',
    'Error: raw failure',
    '2026-11-26T11:00:00 INFO log entry',
    'export SECRET=example-not-for-push',
    'Authorization: Bearer sample-credential',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'data in key',
    '-----END OPENSSH PRIVATE KEY-----',
    'Review `internal code` today.',
  ].join('\n')
  assert.equal(previewText(raw), 'The draft is ready. See the notes. Review today.')
  assert.equal(previewText('共有先はhttps://example.com/share。次に進めます。'), '共有先は。次に進めます。')
  assert.equal(previewText('The **password**: example\nＡＰＩキー：example'), '')
  assert.equal(notificationCopy({ kind: 'completed', sessionTitle: 'password = abcdef', summary: 'ghp_fakeCredential123' }, 'en').body, 'Your session finished responding.')
  assert.deepEqual(replyPreview([text('Line ready.\n```'), text('hidden code\n```\nAny changes?')]), {
    summary: 'Line ready. Any changes?', question: 'Any changes?',
  })
  assert.equal(previewText('The report is ready.\n~~~\nunfinished code'), 'The report is ready.')
})

test('automatic copy is single-line, bounded and slices Unicode on code point boundaries', () => {
  assert.equal(previewText('A\u202e\u0000\n\t\nB\u2028C'), 'A B C')
  assert.equal(previewText('🙂日本語', 3), '🙂日…')
  assert.equal(previewText('ok', 0), '')
  assert.equal(previewText('Ready.\n' + 'x'.repeat(9999)), 'Ready.')
  assert.equal(previewText('x'.repeat(8191) + 'password = long'), '')
  const data = notificationCopy({ kind: 'completed', sessionTitle: '題'.repeat(300), summary: '文'.repeat(300) }, 'ja')
  assert.equal([...data.title].length, 64)
  assert.equal([...data.body].length, 140)
})
