/** Exa settings copy, with English fallback for untranslated locales. */
import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
/** English copy. */
export const en = {
  title: 'Exa search settings', description: 'Search with Exa using anonymous MCP or an API key.',
  useExa: 'Use Exa for web search', useExaHint: 'Changes search only. Turning this off restores the configured default; page fetch stays unchanged.',
  apiKey: 'API key', apiKeyHint: 'Optional. Stored as EXA_API_KEY in the credential store. Without a key, anonymous MCP has shared rate limits. A configured key uses REST API quota.',
  keyConfigured: 'REST API', keyAnonymous: 'Anonymous MCP', removeKey: 'Remove API key',
  maxResults: 'Results per search', maxResultsHint: 'Default result count (1–100) when the request specifies no limit.',
  overridden: 'Overridden', reset: 'Reset to default', readOnly: 'Settings are read-only.', unavailable: 'Exa is not loaded.',
  save: 'Save', saving: 'Saving…', saveFailed: 'Settings could not be read or saved. Retry after checking the connection.',
  invalidNumber: 'Enter a whole number from 1 to 100, or leave blank for the default.',
}
/** Keys rendered by the Exa settings page. */
export type ExaSearchSettingsLocaleKey = keyof typeof en
/** Japanese copy. */
export const ja: Record<ExaSearchSettingsLocaleKey, string> = {
  title: 'Exa検索の設定', description: '匿名MCPまたはAPIキーを使ってExaで検索します。',
  useExa: 'ウェブ検索にExaを使う', useExaHint: '検索だけを切り替えます。オフにすると設定済みの既定値へ戻り、ページ取得の設定は維持します。',
  apiKey: 'APIキー', apiKeyHint: '任意です。EXA_API_KEYとして資格情報ストアに保存します。キーなしの匿名MCPには共有の利用制限があり、キーを設定するとREST APIの利用枠を使います。',
  keyConfigured: 'REST API', keyAnonymous: '匿名MCP', removeKey: 'APIキーを削除',
  maxResults: '1回の検索結果数', maxResultsHint: '呼び出し側が上限を指定しない場合の件数です（1〜100）。',
  overridden: '上書き済み', reset: '既定値に戻す', readOnly: '設定は読み取り専用です。', unavailable: 'Exaは読み込まれていません。',
  save: '保存', saving: '保存中…', saveFailed: '設定の取得または保存に失敗しました。接続を確認して再試行してください。',
  invalidNumber: '1〜100の整数を入力してください。空欄にすると既定値を使います。',
}
/** Simplified Chinese copy. */
export const zh: Record<ExaSearchSettingsLocaleKey, string> = {
  title: 'Exa 搜索设置', description: '通过匿名 MCP 或 API 密钥使用 Exa 搜索。',
  useExa: '使用 Exa 搜索网页', useExaHint: '仅切换搜索；关闭时恢复配置的默认值，不改变网页获取设置。',
  apiKey: 'API 密钥', apiKeyHint: '可选，以 EXA_API_KEY 保存至凭据存储。无密钥的匿名 MCP 共享调用限额；配置密钥后使用 REST API 配额。',
  keyConfigured: 'REST API', keyAnonymous: '匿名 MCP', removeKey: '删除 API 密钥',
  maxResults: '每次搜索结果数', maxResultsHint: '请求未指定上限时的默认数量（1–100）。',
  overridden: '已覆盖', reset: '恢复默认', readOnly: '设置为只读。', unavailable: 'Exa 未加载。',
  save: '保存', saving: '保存中…', saveFailed: '读取或保存设置失败，请检查连接后重试。',
  invalidNumber: '请输入 1–100 的整数，留空使用默认值。',
}
/** English fallback. */
export const es = en
/** English fallback. */
export const fr = en
/** English fallback. */
export const de = en
/** English fallback. */
export const ru = en
/** English fallback. */
export const pt = en
/**
 * Resolve shared settings-form labels.
 * @param t - localized page dictionary.
 * @returns form action and status labels.
 */
export function formLabels(t: (key: ExaSearchSettingsLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
