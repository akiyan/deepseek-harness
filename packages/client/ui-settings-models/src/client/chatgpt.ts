/** Same-origin ChatGPT controls; safe account data only, never OAuth credentials. */
export interface ChatGPTView {
  accounts: { id: string; label: string; connected: boolean; sharing: boolean }[]
  active?: string
  pending: boolean
  authorizeUrl?: string
  error?: string
}

/** Browser actions accepted by the Host account controller. */
export type ChatGPTAction = { action: 'start'; id?: string } | { action: 'select' | 'logout'; id: string } | { action: 'cancel' } | { action: 'complete'; url: string }

/**
 * Read or mutate safe account state through the authenticated Host route.
 * @param action - mutation, or omission for a read.
 * @param signal - request lifetime.
 * @returns validated account state.
 */
export async function requestChatGPT(action?: ChatGPTAction, signal?: AbortSignal): Promise<ChatGPTView> {
  const response = await fetch('/chatgpt/account', {
    method: action === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: { accept: 'application/json', ...action === undefined ? {} : { 'content-type': 'application/json' } },
    ...action === undefined ? {} : { body: JSON.stringify(action) },
    ...signal === undefined ? {} : { signal },
  })
  const payload: unknown = await response.json()
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (!response.ok) throw new Error(object(payload) && typeof payload.error === 'string' ? payload.error : 'ChatGPT account request failed.')
  if (!object(payload) || !Array.isArray(payload.accounts) || typeof payload.pending !== 'boolean') throw new Error('Invalid ChatGPT account response.')
  const accounts = payload.accounts.map((account: unknown) => {
    if (!object(account) || typeof account.id !== 'string' || typeof account.label !== 'string' || typeof account.connected !== 'boolean' || typeof account.sharing !== 'boolean') throw new Error('Invalid ChatGPT account response.')
    return { id: account.id, label: account.label, connected: account.connected, sharing: account.sharing }
  })
  let authorizeUrl: string | undefined
  if (typeof payload.authorizeUrl === 'string' && payload.authorizeUrl.length > 0) {
    if (payload.authorizeUrl !== '/chatgpt/authorize') throw new Error('Invalid ChatGPT sign-in URL.')
    authorizeUrl = payload.authorizeUrl
  }
  return {
    accounts, pending: payload.pending,
    ...typeof payload.active === 'string' ? { active: payload.active } : {},
    ...typeof payload.error === 'string' ? { error: payload.error } : {},
    ...authorizeUrl === undefined ? {} : { authorizeUrl },
  }
}
