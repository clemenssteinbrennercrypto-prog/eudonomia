export const SESSION_PLAN_WORD_LIMIT = 1000

export function countWords(value) {
  const text = String(value || '').trim()
  return text ? text.split(/\s+/u).length : 0
}

export function limitWords(value, limit = SESSION_PLAN_WORD_LIMIT) {
  const text = String(value || '')
  if (countWords(text) <= limit) return text
  return text.trim().split(/\s+/u).slice(0, limit).join(' ')
}
