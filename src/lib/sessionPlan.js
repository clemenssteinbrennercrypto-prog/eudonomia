export const SESSION_PLAN_WORD_LIMIT = 1000

export function countWords(value) {
  const text = String(value || '').trim()
  return text ? text.split(/\s+/u).length : 0
}

export function limitWords(value, limit = SESSION_PLAN_WORD_LIMIT) {
  const text = String(value || '')
  const words = [...text.matchAll(/\S+/gu)]
  if (words.length <= limit) return text
  const finalWord = words[Math.max(0, limit - 1)]
  return finalWord
    ? text.slice(0, finalWord.index + finalWord[0].length)
    : ''
}
