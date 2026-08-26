import { limitWords } from './sessionPlan'

export const QUICK_SESSION_TAGS = ['Deep work', 'Reading', 'Writing', 'Coding', 'Study', 'Meeting']

const cleanText = (value, maxLength) => String(value || '').trim().slice(0, maxLength)

export function normalizeSessionTags(tags) {
  if (!Array.isArray(tags)) return []
  const seen = new Set()
  return tags
    .map(tag => cleanText(tag, 24))
    .filter(Boolean)
    .filter(tag => {
      const key = tag.toLocaleLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 8)
}

export function buildRecentSessionSetups(sessions, limit = 4) {
  if (!Array.isArray(sessions) || limit <= 0) return []

  const seen = new Set()
  const setups = []

  for (const session of sessions) {
    const task = cleanText(session?.task, 80)
    if (!task) continue

    const goal = limitWords(session?.goal).trim()
    const tags = normalizeSessionTags(session?.tags)
    const storedDuration = Object.hasOwn(session || {}, 'plannedDuration')
      ? session.plannedDuration
      : session?.duration
    const duration = storedDuration == null
      ? null
      : Number.isFinite(Number(storedDuration))
        ? Math.min(720, Math.max(1, Math.round(Number(storedDuration))))
        : 30
    const energyLevel = ['fresh', 'medium', 'tired'].includes(session?.energyLevel)
      ? session.energyLevel
      : 'medium'
    const key = JSON.stringify([task.toLocaleLowerCase(), goal.toLocaleLowerCase(), tags.map(tag => tag.toLocaleLowerCase()), duration])

    if (seen.has(key)) continue
    seen.add(key)
    setups.push({ task, goal, tags, duration, energyLevel })
    if (setups.length >= limit) break
  }

  return setups
}
