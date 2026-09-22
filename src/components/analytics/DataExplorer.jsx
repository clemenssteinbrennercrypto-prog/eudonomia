import { useMemo, useState } from 'react'
import {
  buildAnalyticsExport,
  buildCohortProgress,
  buildExplorerSummary,
  knownComparableSessions,
  normalizedOutcome,
} from '../../lib/analyticsModel'
import { fmtDuration } from '../../lib/sessionAnalysisPresentation'
import { SCORE_COMPONENT_LABELS } from '../../lib/attentionScore'

function Filter({ label, value, onChange, children }) {
  return (
    <label className="analytics-filter">
      <span>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)}>{children}</select>
    </label>
  )
}

function Histogram({ distribution }) {
  const max = Math.max(1, ...distribution.bins.map(bin => bin.count))
  return (
    <div className="analytics-histogram" role="img" aria-label={`Distribution of ${distribution.count} measured session averages`}>
      {distribution.bins.map(bin => (
        <div key={bin.label} className="analytics-histogram-column">
          <span>{bin.count}</span>
          <div><i style={{ height: `${Math.max(bin.count ? 8 : 0, (bin.count / max) * 100)}%` }} /></div>
          <small>{bin.label}</small>
        </div>
      ))}
    </div>
  )
}

function outcomeColor(outcome) {
  if (outcome === 'yes') return 'var(--good)'
  if (outcome === 'partly') return 'var(--warn)'
  if (outcome === 'no') return 'var(--bad)'
  return 'var(--text-muted)'
}

function TrendPlot({ rows }) {
  const points = rows.filter(row => row.averageFocus != null)
  if (!points.length) return <p className="analytics-copy">No measured points match these filters.</p>
  const x = index => points.length === 1 ? 500 : 30 + (index / (points.length - 1)) * 940
  const y = value => 230 - value * 2
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point.averageFocus)}`).join(' ')
  return (
    <svg className="analytics-plot" viewBox="0 0 1000 260" role="img" aria-label={`Average attention across ${points.length} sessions`}>
      {[20, 40, 60, 80, 100].map(value => (
        <g key={value}>
          <line x1="30" x2="970" y1={y(value)} y2={y(value)} />
          <text x="2" y={y(value) + 3}>{value}</text>
        </g>
      ))}
      <path d={path} />
      {points.map((point, index) => (
        <circle key={point.id} cx={x(index)} cy={y(point.averageFocus)} r="5" fill={outcomeColor(point.outcome)}>
          <title>{new Date(point.timestamp).toLocaleDateString()} · {point.averageFocus}/100 attention · {point.outcome || 'unrated'}</title>
        </circle>
      ))}
    </svg>
  )
}

function DurationScatter({ rows }) {
  const points = rows.filter(row => row.averageFocus != null && row.durationMinutes != null)
  if (!points.length) return <p className="analytics-copy">No duration/focus pairs match these filters.</p>
  const maxDuration = Math.max(30, ...points.map(point => point.durationMinutes))
  const x = value => 30 + (value / maxDuration) * 940
  const y = value => 230 - value * 2
  return (
    <svg className="analytics-plot" viewBox="0 0 1000 260" role="img" aria-label={`Duration and average attention for ${points.length} sessions`}>
      {[20, 40, 60, 80, 100].map(value => <line key={value} x1="30" x2="970" y1={y(value)} y2={y(value)} />)}
      {points.map(point => (
        <circle key={point.id} cx={x(point.durationMinutes)} cy={y(point.averageFocus)} r="6" fill={outcomeColor(point.outcome)}>
          <title>{point.durationMinutes} min · {point.averageFocus}/100 attention · {point.outcome || 'unrated'}</title>
        </circle>
      ))}
      <text x="30" y="252">0 min</text>
      <text x="970" y="252" textAnchor="end">{maxDuration} min</text>
    </svg>
  )
}

function OutcomeBar({ outcomes }) {
  const total = Object.values(outcomes).reduce((sum, value) => sum + value, 0)
  const items = [
    ['yes', 'Reached', 'var(--good)'],
    ['partly', 'Partly', 'var(--warn)'],
    ['no', 'Missed', 'var(--bad)'],
    ['unrated', 'Unrated', 'var(--text-muted)'],
  ]
  return (
    <>
      <div className="analytics-outcome-bar">
        {items.map(([key, label, color]) => outcomes[key] > 0 && (
          <i key={key} style={{ width: `${(outcomes[key] / total) * 100}%`, background: color }} title={`${label}: ${outcomes[key]}`} />
        ))}
      </div>
      <div className="analytics-outcome-legend">
        {items.map(([key, label, color]) => <span key={key}><i style={{ background: color }} />{label} <b>{outcomes[key]}</b></span>)}
      </div>
    </>
  )
}

function FacetTable({ title, rows }) {
  return (
    <section className="analytics-panel analytics-facet">
      <div className="analytics-section-heading"><h2>{title}</h2><b>{rows.length} groups</b></div>
      {rows.length === 0 ? <p className="analytics-copy">No stored data for this dimension.</p> : (
        <div className="analytics-data-table">
          <div role="row" className="is-head"><span>Condition</span><span>Attention</span><span>Reached</span><span>n</span></div>
          {rows.map(row => (
            <div role="row" key={row.id}>
              <span>{row.label}</span>
              <strong>{row.averageFocus == null ? '—' : `${row.averageFocus}/100`}</strong>
              <strong>{row.outcomeRate == null ? '—' : `${row.outcomeRate}%`}</strong>
              <strong>{row.sessions}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Breakdown({ title, values, empty = 'No stored data.' }) {
  const entries = Object.entries(values).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((sum, [, value]) => sum + value, 0)
  return (
    <section className="analytics-panel analytics-breakdown">
      <div className="analytics-section-heading"><h2>{title}</h2><b>{fmtDuration(total)}</b></div>
      {entries.length === 0 ? <p className="analytics-copy">{empty}</p> : entries.map(([key, value]) => (
        <div className="analytics-breakdown-row" key={key}>
          <span>{key.replaceAll('_', ' ')}</span>
          <i><b style={{ width: `${(value / total) * 100}%` }} /></i>
          <strong>{fmtDuration(value)}</strong>
        </div>
      ))}
    </section>
  )
}

function signedPoints(value) {
  if (value == null) return '—'
  return `${value > 0 ? '+' : ''}${value} pt`
}

function InterventionComparison({ comparisons }) {
  const rows = [
    ['Alerts occurred', comparisons.alerts],
    ['Reminders / nudges occurred', comparisons.nudges],
    ['Protection intervened', comparisons.protection],
  ]
  return (
    <div className="analytics-data-table analytics-intervention-table" role="table" aria-label="Intervention association">
      <div role="row" className="is-head"><span>Signal</span><span>Focus delta</span><span>Outcome delta</span><span>With / without</span></div>
      {rows.map(([label, comparison]) => (
        <div role="row" key={label}>
          <span>{label}</span>
          <strong>{signedPoints(comparison.focusDelta)}</strong>
          <strong>{signedPoints(comparison.outcomeDelta)}</strong>
          <strong>{comparison.with.sessionCount} / {comparison.without.sessionCount}</strong>
        </div>
      ))}
    </div>
  )
}

function downloadAnalytics(sessions, scope) {
  const report = buildAnalyticsExport(sessions, { scope })
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `eudaimonai-analytics-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export default function DataExplorer({ sessions }) {
  const [range, setRange] = useState('all')
  const [outcome, setOutcome] = useState('all')
  const [workspace, setWorkspace] = useState('all')

  const comparable = useMemo(() => knownComparableSessions(sessions), [sessions])
  const workspaces = useMemo(() => {
    const seen = new Map()
    for (const session of comparable) {
      if (session.workspace?.id) seen.set(session.workspace.id, session.workspace.name || session.workspace.id)
    }
    return [...seen.entries()]
  }, [comparable])
  const filtered = useMemo(() => {
    const cutoff = range === '30' ? Date.now() - 30 * 86400000 : range === '90' ? Date.now() - 90 * 86400000 : null
    return comparable.filter(session => {
      if (cutoff && (!(Number.isFinite(session.timestamp)) || session.timestamp < cutoff)) return false
      if (outcome !== 'all' && (normalizedOutcome(session) || 'unrated') !== outcome) return false
      if (workspace !== 'all' && session.workspace?.id !== workspace) return false
      return true
    })
  }, [comparable, outcome, range, workspace])
  const explorer = useMemo(() => buildExplorerSummary(filtered), [filtered])
  const distribution = explorer.distribution
  const progress = useMemo(() => buildCohortProgress(filtered), [filtered])

  return (
    <div className="analytics-explorer">
      <div className="analytics-filter-bar">
        <Filter label="Range" value={range} onChange={setRange}>
          <option value="all">All comparable</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </Filter>
        <Filter label="Outcome" value={outcome} onChange={setOutcome}>
          <option value="all">All outcomes</option>
          <option value="yes">Reached</option>
          <option value="partly">Partly</option>
          <option value="no">Missed</option>
          <option value="unrated">Unrated</option>
        </Filter>
        <Filter label="Workspace" value={workspace} onChange={setWorkspace}>
          <option value="all">All workspaces</option>
          {workspaces.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Filter>
        <div className="analytics-filter-result">
          <div>
            <strong>{filtered.length}</strong>
            <span>sessions · {comparable[0] ? `ruler V${comparable[0].attentionScoringVersion}` : 'no compatible ruler'}</span>
          </div>
          <button type="button" onClick={() => downloadAnalytics(filtered, { range, outcome, workspace })}>Export analysis</button>
        </div>
      </div>

      <section className="analytics-panel analytics-distribution" aria-labelledby="distribution-heading">
        <div className="analytics-section-heading">
          <div>
            <span className="analytics-kicker">Distribution</span>
            <h2 id="distribution-heading">Session average attention</h2>
          </div>
          <b>n={distribution.count}</b>
        </div>
        {distribution.count === 0 ? (
          <p className="analytics-copy">No measured sessions match these filters. Nothing is inferred from missing data.</p>
        ) : (
          <>
            <Histogram distribution={distribution} />
            <div className="analytics-stat-strip">
              <div><span>Mean attention</span><strong>{distribution.mean}/100</strong></div>
              <div><span>Median attention</span><strong>{distribution.median}/100</strong></div>
              <div><span>Middle 50%</span><strong>{distribution.q1}–{distribution.q3}/100</strong></div>
              <div><span>Sample</span><strong>{distribution.count}</strong></div>
            </div>
          </>
        )}
      </section>

      <div className="analytics-explorer-grid">
        <section className="analytics-panel">
          <div className="analytics-section-heading"><div><span className="analytics-kicker">Outcome</span><h2>Reported result</h2></div><b>n={explorer.sessionCount}</b></div>
          {explorer.sessionCount ? <OutcomeBar outcomes={explorer.outcomes} /> : <p className="analytics-copy">No sessions match these filters.</p>}
        </section>
        <section className="analytics-panel">
          <div className="analytics-section-heading"><div><span className="analytics-kicker">Data quality</span><h2>What was actually measured</h2></div><b>{explorer.quality.coveragePct == null ? '—' : `${explorer.quality.coveragePct}% coverage`}</b></div>
          <div className="analytics-stat-strip">
            <div><span>Measured</span><strong>{explorer.quality.measuredSessions}</strong></div>
            <div><span>Unmeasured</span><strong>{explorer.quality.unmeasuredSessions}</strong></div>
            <div><span>Tracking faults</span><strong>{explorer.quality.trackingFaults}</strong></div>
            <div><span>Measured time</span><strong>{fmtDuration(explorer.quality.measuredSeconds)}</strong></div>
          </div>
        </section>
      </div>

      <section className="analytics-panel" aria-labelledby="evidence-heading">
        <div className="analytics-section-heading">
          <div><span className="analytics-kicker">Interventions & output</span><h2 id="evidence-heading">Did the environment react, and did work move?</h2></div>
          <b>association only</b>
        </div>
        <div className="analytics-stat-strip analytics-evidence-strip">
          <div><span>Alerts</span><strong>{explorer.interventions.alerts}</strong></div>
          <div><span>Reminders + nudges</span><strong>{explorer.interventions.gentleReminders + explorer.interventions.preDriftNudges}</strong></div>
          <div><span>Protection actions</span><strong>{explorer.interventions.protectionEvents == null ? '—' : explorer.interventions.protectionEvents}</strong></div>
          <div><span>Output moved</span><strong>{explorer.output.watchedSessions ? `${explorer.output.movedSessions}/${explorer.output.watchedSessions}` : '—'}</strong></div>
        </div>
        <InterventionComparison comparisons={explorer.interventionComparisons} />
        <p className="analytics-footnote">Deltas appear only when both groups contain at least 3 compatible sessions (and at least 3 rated sessions for outcomes). They show association, never causation. A dash can also mean that older sessions did not store the signal.</p>
      </section>

      <section className="analytics-panel">
        <div className="analytics-section-heading"><div><span className="analytics-kicker">Sequence</span><h2>Focus by session</h2></div><b>dot color = outcome</b></div>
        <TrendPlot rows={explorer.trend} />
      </section>

      <section className="analytics-panel">
        <div className="analytics-section-heading"><div><span className="analytics-kicker">Relationship</span><h2>Duration vs focus</h2></div><b>correlation, not causation</b></div>
        <DurationScatter rows={explorer.trend} />
      </section>

      <div className="analytics-facet-grid">
        <FacetTable title="Workspace" rows={explorer.facets.workspace} />
        <FacetTable title="Time of day" rows={explorer.facets.timeOfDay} />
        <FacetTable title="Planned duration" rows={explorer.facets.duration} />
        <FacetTable title="Energy context" rows={explorer.facets.energy} />
      </div>

      <div className="analytics-explorer-grid">
        <Breakdown title="Attention phases" values={explorer.phases} />
        <Breakdown title="Activity alignment" values={explorer.activity} />
      </div>

      <section className="analytics-panel" aria-labelledby="score-components-heading">
        <div className="analytics-section-heading">
          <div><span className="analytics-kicker">Scoring audit</span><h2 id="score-components-heading">Applied score components</h2></div>
          <b>{explorer.scoreComponents.tracedSessions}/{explorer.sessionCount} sessions traced</b>
        </div>
        {explorer.scoreComponents.traceSamples === 0 ? (
          <p className="analytics-copy">These sessions predate component-level score traces. Their resulting scores remain visible, but Analytics will not guess which bonuses or penalties produced them.</p>
        ) : (
          <div className="analytics-component-table">
            {explorer.scoreComponents.components.map(component => (
              <div key={component.id}>
                <span>{SCORE_COMPONENT_LABELS[component.id] || component.id}</span>
                <strong className={component.averageDeltaWhenActive >= 0 ? 'is-positive' : 'is-negative'}>
                  {component.averageDeltaWhenActive > 0 ? '+' : ''}{component.averageDeltaWhenActive}
                </strong>
                <small>{component.activeSharePct}% of traced samples · {component.activeSamples} active</small>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="analytics-panel" aria-labelledby="cohort-table-heading">
        <div className="analytics-section-heading">
          <div>
            <span className="analytics-kicker">Cohorts</span>
            <h2 id="cohort-table-heading">Latest 8 vs previous 8</h2>
          </div>
          <b>{progress.comparisonReady ? 'Comparable' : 'Collecting'}</b>
        </div>
        <div className="analytics-data-table" role="table" aria-label="Cohort comparison">
          <div role="row" className="is-head"><span role="columnheader">Metric</span><span role="columnheader">Latest</span><span role="columnheader">Previous</span></div>
          <div role="row"><span role="cell">Sessions</span><strong role="cell">{progress.current.sessionCount}</strong><strong role="cell">{progress.previous.sessionCount}</strong></div>
          <div role="row"><span role="cell">Goal reached</span><strong role="cell">{progress.current.hitRate == null ? '—' : `${progress.current.hitRate}%`}</strong><strong role="cell">{progress.previous.hitRate == null ? '—' : `${progress.previous.hitRate}%`}</strong></div>
          <div role="row"><span role="cell">Average attention</span><strong role="cell">{progress.current.averageFocus == null ? '—' : `${progress.current.averageFocus}/100`}</strong><strong role="cell">{progress.previous.averageFocus == null ? '—' : `${progress.previous.averageFocus}/100`}</strong></div>
          <div role="row"><span role="cell">Measured time</span><strong role="cell">{fmtDuration(progress.current.measuredSeconds)}</strong><strong role="cell">{fmtDuration(progress.previous.measuredSeconds)}</strong></div>
        </div>
        {!progress.comparisonReady && <p className="analytics-footnote">A delta is withheld until both cohorts contain 8 compatible usable sessions.</p>}
      </section>
    </div>
  )
}
