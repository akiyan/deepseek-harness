/** Protected ChatGPT registrations; all mutations use the credential store's process lock. */
import { ChatGPTError } from './error.ts'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'

/** Protected credential record owned by this integration. */
export const CHATGPT_KEY = credentialKey('llm-pi-ai', 'chatgpt')
const tokens = z.object({
  access: z.string().min(1), refresh: z.string().optional(), idToken: z.string().optional(),
  expires: z.number(), scopes: z.array(z.string()),
})
const account = z.object({
  id: z.uuid(), generation: z.uuid(), clientId: z.string().min(1), subject: z.string().optional(),
  email: z.string().optional(), tokens: tokens.optional(),
})
const document = z.object({ version: z.literal(1), hostId: z.string().startsWith('urn:uuid:'), active: z.string().optional(), accounts: z.array(account) })

/** One validated account registration, retained after sign-out. */
export type ChatGPTAccount = z.infer<typeof account>
/** Credentials stored only in the Host credential plane. */
export type ChatGPTTokens = z.infer<typeof tokens>
/** One host's registration collection. */
export type ChatGPTDocument = z.infer<typeof document>

/**
 * Validate a protected registration record.
 * @param record - protected record.
 * @returns validated state, or a new host on first use.
 */
export function readDocument(record: CredentialRecord | undefined): ChatGPTDocument {
  if (record === undefined) return { version: 1, hostId: `urn:uuid:${randomUUID()}`, accounts: [] }
  const parsed = record.kind === 'grant' ? document.safeParse(record.payload) : undefined
  if (!parsed?.success) throw new ChatGPTError('ChatGPT credentials are invalid; restore the credential file before continuing.', 'CHATGPT_STORAGE')
  return parsed.data
}

/**
 * Read existing registrations without allocating a host.
 * @param store - Host credential service.
 * @returns the existing state, without creating an installation.
 */
export async function loadDocument(store: CredentialProvider): Promise<ChatGPTDocument | undefined> {
  const record = await store.readRecord(CHATGPT_KEY)
  return record === undefined ? undefined : readDocument(record)
}

/**
 * Commit a registration update under the credential writer lock.
 * @param store - Host credential service.
 * @param mutate - exclusive update.
 * @returns committed state.
 */
export async function updateDocument(
  store: CredentialProvider,
  mutate: (state: ChatGPTDocument) => void | Promise<void>,
): Promise<ChatGPTDocument> {
  const record = await store.modifyRecord(CHATGPT_KEY, async (current) => {
    const state = readDocument(current)
    await mutate(state)
    return { kind: 'grant', payload: state }
  })
  return readDocument(record)
}
