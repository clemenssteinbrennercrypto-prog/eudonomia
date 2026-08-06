const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'for', 'from', 'get',
  'in', 'into', 'it', 'make', 'my', 'of', 'on', 'or', 'our', 'the', 'this',
  'to', 'up', 'with', 'work', 'session', 'focus', 'goal', 'task',
])

const INTENT_PROFILES = [
  {
    id: 'software',
    label: 'Software work',
    keywords: [
      'api', 'app', 'backend', 'bug', 'build', 'code', 'coding', 'commit',
      'component', 'debug', 'deploy', 'frontend', 'github', 'implement', 'issue',
      'javascript', 'next', 'pr', 'react', 'refactor', 'repo', 'review', 'ship',
      'test', 'typescript', 'ui', 'vite',
    ],
    tools: [
      'android studio', 'cursor', 'github desktop', 'intellij', 'iterm',
      'pycharm', 'terminal', 'visual studio code', 'warp', 'webstorm', 'xcode',
    ],
    domains: [
      'developer.mozilla.org', 'docs.github.com', 'github.com', 'gitlab.com',
      'npmjs.com', 'react.dev', 'stackoverflow.com', 'vitejs.dev', 'vercel.com',
    ],
  },
  {
    id: 'writing',
    label: 'Writing',
    keywords: [
      'article', 'brief', 'copy', 'draft', 'edit', 'essay', 'memo', 'notes',
      'outline', 'paper', 'proposal', 'readme', 'report', 'revise', 'write',
      'writing',
    ],
    tools: ['bear', 'docs', 'google docs', 'grammarly', 'notion', 'obsidian', 'pages', 'ulysses', 'word'],
    domains: ['docs.google.com', 'grammarly.com', 'notion.so', 'overleaf.com'],
  },
  {
    id: 'research',
    label: 'Research',
    keywords: [
      'analyze', 'compare', 'evidence', 'learn', 'literature', 'paper',
      'read', 'research', 'source', 'study', 'summarize',
    ],
    tools: ['arc', 'chrome', 'firefox', 'safari', 'zotero'],
    domains: [
      'arxiv.org', 'docs.google.com', 'drive.google.com', 'google.com',
      'pubmed.ncbi.nlm.nih.gov', 'scholar.google.com', 'wikipedia.org',
    ],
  },
  {
    id: 'design',
    label: 'Design',
    keywords: [
      'brand', 'design', 'figma', 'illustration', 'layout', 'mockup',
      'prototype', 'ui', 'ux', 'visual', 'wireframe',
    ],
    tools: ['figma', 'illustrator', 'photoshop', 'sketch'],
    domains: ['figma.com', 'dribbble.com', 'behance.net'],
  },
  {
    id: 'planning',
    label: 'Planning',
    keywords: [
      'backlog', 'calendar', 'plan', 'planning', 'roadmap', 'schedule',
      'spec', 'strategy', 'todo',
    ],
    tools: ['calendar', 'linear', 'notion', 'reminders', 'things'],
    domains: ['calendar.google.com', 'linear.app', 'notion.so', 'trello.com'],
  },
]

const COMMON_DISTRACTIONS = {
  apps: [
    'discord', 'instagram', 'netflix', 'reddit', 'slack', 'spotify', 'steam',
    'tiktok', 'twitch', 'x', 'youtube',
  ],
  domains: [
    'discord.com', 'facebook.com', 'instagram.com', 'netflix.com', 'reddit.com',
    'tiktok.com', 'twitch.tv', 'x.com', 'youtube.com',
  ],
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

export function normalizeDomain(value) {
  const raw = normalizeText(value)
  if (!raw) return ''
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
    return new URL(withProtocol).hostname.replace(/^www\./, '')
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0].trim()
  }
}

export function domainMatches(domain, candidates = []) {
  const normalizedDomain = normalizeDomain(domain)
  if (!normalizedDomain) return false
  return candidates.some(candidate => {
    const normalizedCandidate = normalizeDomain(candidate)
    return normalizedCandidate &&
      (normalizedDomain === normalizedCandidate || normalizedDomain.endsWith(`.${normalizedCandidate}`))
  })
}

function tokenize(value) {
  return normalizeText(value)
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^a-z0-9.+#-]+/i)
    .map(token => token.trim())
    .filter(token => token.length >= 3 && !STOP_WORDS.has(token))
}

function unique(items) {
  return [...new Set(items.filter(Boolean))]
}

function textIncludesAny(text, candidates = []) {
  const haystack = normalizeText(text)
  return candidates.some(candidate => {
    const needle = normalizeText(candidate)
    return needle && haystack.includes(needle)
  })
}

function appMatchesAny(appKey, candidates = []) {
  return candidates.some(candidate => {
    const needle = normalizeText(candidate)
    if (!needle) return false
    return needle.length <= 2 ? appKey === needle : appKey.includes(needle)
  })
}

function matchProfileScores(tokens) {
  const tokenSet = new Set(tokens)
  return INTENT_PROFILES
    .map(profile => ({
      profile,
      score: profile.keywords.reduce((sum, keyword) => sum + (tokenSet.has(keyword) ? 1 : 0), 0),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
}

// `goal` is one sentence describing what done looks like. It used to be three
// fields — goal, intended output, success criteria — which asked the same
// question three ways and charged the user three text boxes for it.
//
// `energyLevel` is recorded as CONTEXT and deliberately does not touch scoring.
// Shifting the thresholds by self-reported mood made the same behaviour score
// differently day to day, which destroys comparability across sessions — and
// comparable history is the whole point of measuring at all. Energy belongs in
// the interpretation ("your tired sessions run 12 points lower"), never in the
// ruler.
export function deriveSessionIntent({ task = '', goal = '', energyLevel = 'medium', tags = [] } = {}) {
  const tagText = Array.isArray(tags) ? tags.join(' ') : ''
  const text = [task, goal, tagText].filter(Boolean).join(' ')
  const tokens = unique(tokenize(text))
  const profileScores = matchProfileScores(tokens)
  const primaryProfile = profileScores[0]?.profile || null
  const secondaryProfiles = profileScores.slice(1, 3).map(item => item.profile)
  const profiles = unique([primaryProfile, ...secondaryProfiles].filter(Boolean))
  const toolHints = unique(profiles.flatMap(profile => profile.tools))
  const domainHints = unique(profiles.flatMap(profile => profile.domains))
  const confidence = !text.trim()
    ? 'none'
    : profileScores[0]?.score >= 2
      ? 'medium'
      : tokens.length >= 4
        ? 'low'
        : 'partial'

  return {
    sourceText: text.trim(),
    task: String(task || '').trim(),
    goal: String(goal || '').trim(),
    tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
    keywords: tokens,
    primaryKind: primaryProfile?.id || 'general',
    primaryLabel: primaryProfile?.label || 'General work',
    confidence,
    energyLevel: String(energyLevel || 'medium'),
    toolHints,
    domainHints,
  }
}

// Window titles name the thing being worked on, not just the tool holding it.
// "thesis_intro_v3.docx — Word" is the difference between "you were in Word for
// 40 minutes" and "you were in thesis_intro_v3 for 40 minutes". The companion
// already reports this field; until now it was only used as a fallback label.
//
// Titles are `<artifact><sep><app>` on macOS, with the app name trailing. We
// take the leading segment and drop a trailing app name when it matches.
const TITLE_SEPARATORS = /\s+[—–|]\s+|\s+-\s+/

export function artifactFromTitle(title, app = '') {
  const raw = String(title || '').trim()
  if (!raw) return ''
  const parts = raw.split(TITLE_SEPARATORS).map(p => p.trim()).filter(Boolean)
  if (parts.length === 0) return ''
  const appKey = String(app || '').trim().toLowerCase()
  // Drop trailing segments that are just the app itself ("… — Word").
  while (parts.length > 1 && appKey && parts[parts.length - 1].toLowerCase() === appKey) {
    parts.pop()
  }
  const first = parts[0]
  // Browser tabs often read "Inbox (12)" — the unread count is noise, not identity.
  return first.replace(/\s*\(\d+\)\s*$/, '').trim()
}

// `contract` is optional and takes precedence when present. It knows what THIS
// goal needs — "youtube.com is off-goal for writing your thesis" — where the
// keyword profiles only know what writing generally looks like. Without one,
// behaviour is exactly as before.
export function classifyGoalAwareActivity(activity, config, daemonConnected, sessionIntent, contract = null) {
  if (!daemonConnected) {
    return { kind: 'unclear', app: '', domain: '', label: 'No activity data', basis: 'no_activity_data' }
  }

  const app = String(activity?.app || '').trim()
  const appKey = app.toLowerCase()
  const domain = normalizeDomain(activity?.domain || activity?.full_url || activity?.url)
  const domainKey = domain.toLowerCase()
  const activityText = [app, domain, activity?.title, activity?.window].filter(Boolean).join(' ')
  const title = String(activity?.title || activity?.window || '').trim()
  // For a browser the domain IS the artifact; for a native app it's the document.
  const artifact = domain || artifactFromTitle(title, app) || app
  const label = domain || title || app || 'Unknown'

  if (!appKey && !domainKey) {
    return { kind: 'unclear', app, domain, label: 'No activity data', basis: 'no_activity_data' }
  }

  const focusApps = config?.focusApps || []
  const distractionApps = config?.distractionApps || []
  const focusDomains = config?.focusDomains || []
  const distractionDomains = config?.distractionDomains || []
  const focusAppKeys = new Set(focusApps.map(item => item.toLowerCase()))
  const distractionAppKeys = new Set(distractionApps.map(item => item.toLowerCase()))

  const blockedByUser = Boolean(appKey && distractionAppKeys.has(appKey)) ||
    Boolean(domainKey && distractionAppKeys.has(domainKey)) ||
    domainMatches(domain, distractionDomains)
  if (blockedByUser) {
    return { kind: 'blocked', app, domain, title, artifact, label, basis: 'personal_blocker' }
  }

  // ── Contract first ────────────────────────────────────────────────────────
  // The user's own blocklist above still wins: their explicit rule outranks any
  // model's opinion about their goal.
  if (contract) {
    if (contract.offGoal?.length && (appMatchesAny(appKey, contract.offGoal) || domainMatches(domain, contract.offGoal))) {
      return { kind: 'distraction', app, domain, title, artifact, label, basis: 'contract_off_goal' }
    }
    if (contract.expectedTools?.length && (appMatchesAny(appKey, contract.expectedTools) || domainMatches(domain, contract.expectedTools))) {
      return { kind: 'aligned', app, domain, title, artifact, label, basis: 'contract_tool' }
    }
    // The artifact the contract expects, seen in a window title, is the
    // strongest signal there is: not just the right app, the right document.
    if (contract.output?.artifactHint && textIncludesAny(activityText, [contract.output.artifactHint])) {
      return { kind: 'aligned', app, domain, title, artifact, label, basis: 'contract_artifact' }
    }
    if (contract.supporting?.length && (appMatchesAny(appKey, contract.supporting) || domainMatches(domain, contract.supporting))) {
      return { kind: 'supportive', app, domain, title, artifact, label, basis: 'contract_supporting' }
    }
  }

  const intent = sessionIntent || deriveSessionIntent()
  const matchesIntentKeyword = intent.keywords?.length > 0 && textIncludesAny(activityText, intent.keywords)
  const matchesIntentTool = textIncludesAny(app, intent.toolHints)
  const matchesIntentDomain = domainMatches(domain, intent.domainHints)
  const allowedByUser = Boolean(appKey && focusAppKeys.has(appKey)) ||
    Boolean(domainKey && focusAppKeys.has(domainKey)) ||
    domainMatches(domain, focusDomains)

  if (matchesIntentKeyword) {
    return { kind: 'aligned', app, domain, title, artifact, label, basis: 'session_keyword' }
  }
  if (matchesIntentTool || matchesIntentDomain) {
    return { kind: 'supportive', app, domain, title, artifact, label, basis: 'session_tool' }
  }
  if (allowedByUser) {
    return { kind: intent.confidence === 'none' ? 'aligned' : 'supportive', app, domain, title, artifact, label, basis: 'personal_focus_rule' }
  }

  const commonlyDistracting = appMatchesAny(appKey, COMMON_DISTRACTIONS.apps) ||
    domainMatches(domain, COMMON_DISTRACTIONS.domains)
  if (commonlyDistracting) {
    return { kind: 'distraction', app, domain, title, artifact, label, basis: 'common_distraction' }
  }

  // A confident contract listing expected tools is entitled to say "this isn't
  // any of them" — which is exactly what the keyword profiles could never do
  // for a goal outside their six categories.
  if (contract?.confidence === 'high' && contract.expectedTools?.length) {
    return { kind: 'off_goal', app, domain, title, artifact, label, basis: 'contract_unmatched' }
  }
  if (intent.confidence === 'medium') {
    return { kind: 'off_goal', app, domain, title, artifact, label, basis: 'unmatched_session_context' }
  }

  return { kind: 'unclear', app, domain, title, artifact, label, basis: 'insufficient_context' }
}

export function emptyActivityAlignmentSummary() {
  return {
    secondsByKind: {
      blocked: 0,
      aligned: 0,
      supportive: 0,
      unclear: 0,
      off_goal: 0,
      distraction: 0,
    },
    byActivity: {},
    byArtifact: {},
    events: [],
  }
}

export function recordActivityAlignment(summary, classification, second) {
  const next = summary || emptyActivityAlignmentSummary()
  const kind = classification?.kind || 'unclear'
  if (next.secondsByKind[kind] == null) next.secondsByKind[kind] = 0
  next.secondsByKind[kind] += 1

  const key = classification?.domain || classification?.app || classification?.label || 'Unknown'
  if (!next.byActivity[key]) {
    next.byActivity[key] = {
      label: classification?.label || key,
      app: classification?.app || '',
      domain: classification?.domain || '',
      kind,
      basis: classification?.basis || 'unknown',
      seconds: 0,
    }
  }
  next.byActivity[key].seconds += 1

  // Time spent on the actual thing being worked on. This is what turns
  // "40 minutes in Word" into "40 minutes on thesis_intro_v3".
  const artifact = classification?.artifact || classification?.app
  if (artifact) {
    if (!next.byArtifact) next.byArtifact = {}
    if (!next.byArtifact[artifact]) {
      next.byArtifact[artifact] = { artifact, app: classification?.app || '', kind, seconds: 0 }
    }
    next.byArtifact[artifact].seconds += 1
  }
  if (next.byActivity[key].seconds === 1 && kind !== 'aligned' && kind !== 'supportive' && kind !== 'unclear') {
    next.events.push({ second, kind, label: classification?.label || key, basis: classification?.basis || 'unknown' })
  }
  return next
}

export function summarizeSessionAlignment(activitySummary, actualSeconds = 0) {
  const summary = activitySummary || emptyActivityAlignmentSummary()
  const secondsByKind = { ...emptyActivityAlignmentSummary().secondsByKind, ...(summary.secondsByKind || {}) }
  const observedSeconds = Object.values(secondsByKind).reduce((sum, value) => sum + (Number(value) || 0), 0)
  const denominator = observedSeconds || actualSeconds || 0
  const alignedSeconds = secondsByKind.aligned + secondsByKind.supportive
  const driftSeconds = secondsByKind.off_goal + secondsByKind.distraction + secondsByKind.blocked
  const alignedPct = denominator > 0 ? Math.round((alignedSeconds / denominator) * 100) : null
  const driftPct = denominator > 0 ? Math.round((driftSeconds / denominator) * 100) : null
  const topActivities = Object.values(summary.byActivity || {})
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5)
  const topArtifacts = Object.values(summary.byArtifact || {})
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5)

  return {
    secondsByKind,
    observedSeconds,
    alignedSeconds,
    driftSeconds,
    alignedPct,
    driftPct,
    topActivities,
    topArtifacts,
    driftEvents: summary.events || [],
  }
}
