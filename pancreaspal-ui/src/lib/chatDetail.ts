import type { QueryMode, SourceDocument } from './api/patientApi'

export const CHAT_ERROR_MESSAGE =
  'Sorry, I could not get a response. Please try again.'

const NO_CONTEXT_PREFIX = 'I do not have enough information in the medical library'
const NO_METRICS_PREFIX = 'You have not logged any health metrics yet'

export function isDetailEligible(answer: string): boolean {
  const text = answer.trim()
  if (!text || text === CHAT_ERROR_MESSAGE) return false
  if (text.startsWith(NO_CONTEXT_PREFIX)) return false
  if (text.startsWith(NO_METRICS_PREFIX)) return false
  return true
}

export type ChatAnswerResult = {
  text: string
  sources?: SourceDocument[]
  turnId?: string
  detailEligible: boolean
}

export type PendingDetailOffer = {
  turnId: string
  queryMode: QueryMode
}

/** One in-flight initial query per (mode, question) — avoids duplicate POST /query from Strict Mode remounts. */
const initialQueryInflight = new Map<string, Promise<ChatAnswerResult>>()

export function coalesceInitialChatQuery(
  queryMode: QueryMode,
  question: string,
  run: () => Promise<ChatAnswerResult>,
): Promise<ChatAnswerResult> {
  const key = `${queryMode}\u0001${question}`
  const existing = initialQueryInflight.get(key)
  if (existing) return existing

  const promise = run().finally(() => {
    if (initialQueryInflight.get(key) === promise) {
      initialQueryInflight.delete(key)
    }
  })
  initialQueryInflight.set(key, promise)
  return promise
}
