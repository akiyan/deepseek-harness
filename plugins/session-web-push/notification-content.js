const maxInput = 8192
const maxBlocks = 32
const maxPreview = 140
const maxTitle = 64
const appName = 'DeepSeek Harness'

const copy = {
  ja: {
    completed: ['', 'セッションの応答が完了しました。'],
    error: ['[エラー]', 'セッションがエラーで終了しました。'],
    approval: ['[承認待ち]', 'セッションで承認を待っています。'],
    question: ['[要回答]', 'セッションで回答を待っています。'],
    followup: ['[要回答]', 'セッションの応答に質問があります。'],
    test: 'このブラウザで通知を受け取れます。',
  },
  en: {
    completed: ['', 'Your session finished responding.'],
    error: ['[Error]', 'Your session ended with an error.'],
    approval: ['[Approval needed]', 'Your session is waiting for approval.'],
    question: ['[Response needed]', 'Your session is waiting for an answer.'],
    followup: ['[Response needed]', 'Your session reply includes a question.'],
    test: 'This browser can receive notifications.',
  },
}

// Best effort only: ordinary prose can still contain private information.
// Reject a line with recognizable credential markers rather than guessing where its value ends.
const sensitive = [
  /\b(?:api[ _-]?key|(?:(?:access|auth|refresh)[ _-]?)?token|password|passphrase|secret|otp|pin|authorization|(?:set[-_])?cookie)["']?\s*[:=]/iu,
  /(?:パスワード|認証トークン|秘密鍵|APIキー)\s*[:：=]/iu,
  /\b(?:bearer|basic)\s+[\w.+/=-]{6,}|:\/\/[^\s/@:]+:[^\s/@]+@/iu,
  /\b(?:sk[-_]|gh[pousr]_|github_pat_|xox[baprs]-|AKIA|ASIA)[a-z0-9_-]{6,}/iu,
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b|\b[a-f0-9]{32,}\b|\b[a-z0-9_+/-]{40,}\b/iu,
]
const logOrCode = /^(?:\[?(?:TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\s*[:\]]|\d{4}-\d\d-\d\d[ T]\d\d:\d\d|Traceback \(|(?:Error|Exception|\w+Error):|at [\w.<>]+\s*\(|[\w.]+@[^\s]+:[~/$]|[$%>]\s|(?:const|let|var|function|def|import|export)\s+\w+\s*[=(;]|[{}[\]|]|[A-Z][A-Z0-9_]*\s*=)/u

function boundedInput(text) {
  if (text.length <= maxInput) return text
  // Do not show a partial line whose omitted tail might identify it as sensitive.
  const prefix = text.slice(0, maxInput)
  return prefix.slice(0, Math.max(0, prefix.lastIndexOf('\n')))
}

function proseLines(text) {
  if (typeof text !== 'string') return []
  const cleaned = boundedInput(text)
    .replace(/\r\n?|[\p{Zl}\p{Zp}]/gu, '\n')
    .replace(/[^\S\n\t]/gu, ' ')
    .replace(/[\p{Cf}\p{Cc}\p{Cs}]/gu, char => char === '\n' || char === '\t' ? char : '')
    .replace(/<(think|thinking|reasoning|pre|code|script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu, '\n')
    .replace(/<!--[\s\S]*?(?:-->|$)/gu, '\n')
    .replace(/-----BEGIN [\w -]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [\w -]{0,40}PRIVATE KEY-----|$)/giu, '\n')
  let fence
  const lines = []
  for (let line of cleaned.split('\n')) {
    // The search also finds quoted/list fences; drop uncertain markup rather than preview its contents.
    const marker = /(`{3,}|~{3,})/u.exec(line)?.[0]
    if (fence) {
      if (new RegExp(`^\\s*(?:>\\s*)?${fence[0]}{${fence.length},}\\s*$`, 'u').test(line)) fence = undefined
      continue
    }
    if (marker) {
      if (!line.slice(line.indexOf(marker) + marker.length).includes(marker)) fence = marker
      continue
    }
    if (/^(?: {4}|\t)/u.test(line)) continue
    line = line.trim().replace(/^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/u, '')
    if (!line || logOrCode.test(line)) continue
    const possibleCredential = line.normalize('NFKC').replace(/[*_~]{2,}|`+/gu, '')
    if (sensitive.some(pattern => pattern.test(line) || pattern.test(possibleCredential))) continue
    line = line
      .replace(/(`+).*?\1(?!`)|`.*$/gu, ' ')
      .replace(/!\[[^\]]*\](?:\((?:[^()]|\([^()]*\))*\)|\[[^\]]*\])?/gu, ' ')
      .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/gu, '$1')
      .replace(/\[([^\]]+)\]\[[^\]]*\]/gu, '$1')
      .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:|data:)[^\s<>「」『』【】。、！？]+|\/\/[^\s<>「」『』【】。、！？]+/giu, ' ')
      .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#][^\s<>「」『』【】。、！？]*)?/giu, ' ')
      .replace(/(?:^|\s)(?:~?\/|[A-Z]:\\)[^\s<>「」『』【】。、！？]+/gu, ' ')
      .replace(/<[^>]*>|[*_~]{2,}|\\(?=[*_~])/gu, '')
      .replace(/\s+/gu, ' ').replace(/\s+([、。！？])/gu, '$1').trim()
    if (/\p{L}|\p{N}/u.test(line)) lines.push(line)
  }
  return lines
}

function truncate(text, max) {
  const limit = Number.isSafeInteger(max) ? Math.min(max, maxInput) : maxPreview
  if (limit <= 0) return ''
  const characters = [...text]
  if (characters.length <= limit) return text
  return `${characters.slice(0, limit - 1).join('').trimEnd()}…`
}

/** A bounded one-line preview; returns an empty string if there's no usable prose. */
export function previewText(text, max = maxPreview) {
  return truncate(proseLines(text).join(' '), max)
}

/** The caller selects a public final reply; only visible text blocks participate. */
export function replyPreview(content) {
  let text = typeof content === 'string' ? content : ''
  if (Array.isArray(content)) {
    for (const block of content.slice(0, maxBlocks)) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      const remaining = maxInput + 1 - text.length
      text += `${text ? '\n' : ''}${block.text.slice(0, remaining)}`
      if (text.length > maxInput) break
    }
  }
  const lines = proseLines(text)
  if (!lines.length) return {}
  const summary = truncate(lines.join(' '), maxPreview)
  // Only a final, explicit prose question is a candidate; status is the caller's decision.
  const tail = lines.at(-1).split(/[。！？](?!$)|[.!?](?=\s)/u).at(-1).trim()
  return /[?？]$/u.test(tail) ? { summary, question: truncate(tail, maxPreview) } : { summary }
}

/** Localize the outcome and preserve manual/test copy exactly. */
export function notificationCopy({ kind, sessionTitle, summary, question, message }, language) {
  const localized = language === 'ja' ? copy.ja : copy.en
  if (kind === 'manual') return { title: appName, body: message }
  if (kind === 'test') return { title: appName, body: localized.test }
  const [status, fallback] = Object.hasOwn(localized, kind) ? localized[kind] : localized.completed
  const name = previewText(sessionTitle, maxTitle) || appName
  return {
    title: status ? `${status} ${name}` : name,
    body: previewText(question) || previewText(summary) || fallback,
  }
}
