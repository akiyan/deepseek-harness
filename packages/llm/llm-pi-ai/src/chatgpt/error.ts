/** Structured ChatGPT failures kept within this provider integration. */
import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Account and protocol failure classes. */
export type ChatGPTCode =
  | 'CHATGPT_ACCOUNT'
  | 'CHATGPT_ACCOUNT_CHANGED'
  | 'CHATGPT_BUSY'
  | 'CHATGPT_CALLBACK'
  | 'CHATGPT_DECLINED'
  | 'CHATGPT_IDENTITY'
  | 'CHATGPT_MODELS'
  | 'CHATGPT_NETWORK'
  | 'CHATGPT_PAYLOAD'
  | 'CHATGPT_PERMISSION'
  | 'CHATGPT_REQUEST'
  | 'CHATGPT_REVOCATION'
  | 'CHATGPT_SIGN_IN_REQUIRED'
  | 'CHATGPT_STORAGE'
  | 'CHATGPT_TOKEN'

/** OAuth/API diagnostics without token bodies or authorization URLs. */
export class ChatGPTError extends HarnessError {
  /** Machine-readable OAuth or Responses code, when supplied. */
  readonly requestCode: string | undefined
  /** HTTP status retained for diagnosis. */
  readonly status: number | undefined
  /** OpenAI request identifier, when available. */
  readonly requestId: string | undefined
  constructor(message: string, code: ChatGPTCode, options?: ErrorOptions & { requestCode?: string; status?: number; requestId?: string }) {
    super(message, code, options)
    this.requestCode = options?.requestCode
    this.status = options?.status
    this.requestId = options?.requestId
  }
}
