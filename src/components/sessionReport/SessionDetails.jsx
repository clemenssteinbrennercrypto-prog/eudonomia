import { fmtDuration, fmtClock, energyInterpretation } from '../../lib/sessionAnalysisPresentation'
import { DISTRACTION_LABELS, PHASE_LABELS, PHASE_COLORS, ACTIVITY_KIND_LABELS, ACTIVITY_KIND_COLORS, ENERGY_LABELS } from './constants'

function PhaseBreakdown({ phaseSeconds }) {
  const entries = Object.entries(phaseSeconds).filter(([, seconds]) => seconds > 0)
  if (!entries.length) return null
  return (
    <div>
      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 8px' }}>Attention phases</p>
      <div style={{ display: 'flex', height: 8, width: '100%', borderRadius: 999, overflow: 'hidden', background: 'rgba(122,152,255,0.06)' }}>
        {entries.map(([phase, seconds]) => (
          <div key={phase} title={`${PHASE_LABELS[phase] || phase}: ${fmtDuration(seconds)}`}
            style={{ flex: seconds, minWidth: 2, background: PHASE_COLORS[phase] || 'var(--text-muted)' }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: 8 }}>
        {entries.map(([phase, seconds]) => (
          <span key={phase} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {PHASE_LABELS[phase] || phase}: {fmtDuration(seconds)}
          </span>
        ))}
      </div>
    </div>
  )
}

function ActivityAlignment({ activity, sessionIntent }) {
  if (!activity) return null
  const kindEntries = Object.entries(activity.secondsByKind).filter(([, seconds]) => seconds > 0)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', margin: 0 }}>Activity alignment</p>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
          {sessionIntent?.primaryLabel || 'General work'} · {sessionIntent?.confidence || 'partial'} confidence
        </span>
      </div>
      <div style={{ display: 'flex', height: 8, width: '100%', borderRadius: 999, overflow: 'hidden', background: 'rgba(122,152,255,0.06)' }}>
        {kindEntries.map(([kind, seconds]) => (
          <div key={kind} title={`${ACTIVITY_KIND_LABELS[kind] || kind}: ${fmtDuration(seconds)}`}
            style={{ flex: seconds, minWidth: 2, background: ACTIVITY_KIND_COLORS[kind] || 'var(--text-muted)' }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: 8 }}>
        {kindEntries.map(([kind, seconds]) => (
          <span key={kind} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {ACTIVITY_KIND_LABELS[kind] || kind}: {fmtDuration(seconds)}
          </span>
        ))}
      </div>
      {activity.topActivities.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {activity.topActivities.map(item => (
            <div key={`${item.kind}-${item.label}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
              <span style={{ color: ACTIVITY_KIND_COLORS[item.kind] || 'var(--text-muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {ACTIVITY_KIND_LABELS[item.kind] || item.kind} · {fmtDuration(item.seconds)}
              </span>
            </div>
          ))}
        </div>
      )}
      {activity.topArtifacts?.length > 0 && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 8px' }}>What you worked on</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activity.topArtifacts.map(item => (
              <div key={item.artifact} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.artifact}
                  {item.app && item.app !== item.artifact && <span style={{ color: 'var(--text-muted)' }}> · {item.app}</span>}
                </span>
                <span style={{ color: 'var(--text)', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtDuration(item.seconds)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function OutputEvidence({ output }) {
  if (!output) return null
  const moved = output.filesChanged + output.filesCreated
  const kb = Math.round((output.bytesAdded || 0) / 1024)
  return (
    <div>
      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 8px' }}>What came out of it</p>
      {moved === 0 && !output.commits ? (
        <p style={{ fontSize: 13, color: 'var(--warn)', margin: 0, lineHeight: 1.5 }}>
          Nothing changed in the watched folder. Focused, but the work didn't move —
          worth asking whether it was the right task, or whether you were stuck.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--good)', fontWeight: 600, margin: 0 }}>
            {[
              moved ? `${moved} file${moved === 1 ? '' : 's'} changed` : null,
              kb ? `${kb > 0 ? '+' : ''}${kb} KB` : null,
              output.commits ? `${output.commits} commit${output.commits === 1 ? '' : 's'}` : null,
              (output.linesAdded || output.linesRemoved) ? `+${output.linesAdded} −${output.linesRemoved} lines` : null,
            ].filter(Boolean).join(' · ')}
          </p>
          {output.changedNames?.length > 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
              {output.changedNames.slice(0, 5).join(', ')}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function DistractionLog({ distractionLog }) {
  if (!distractionLog.length) return null
  return (
    <div>
      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 10px' }}>What distracted you</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {distractionLog.map((ev, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--bg)', border: '1px solid var(--line)',
            borderRadius: 10, padding: '8px 14px',
            fontSize: 13, color: 'var(--text-secondary)',
          }}>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: 12 }}>{fmtClock(ev.second)}</span>
            <span style={{ color: 'var(--line-strong)' }}>·</span>
            <span style={{ fontWeight: 500 }}>{DISTRACTION_LABELS[ev.reason] ?? DISTRACTION_LABELS.default}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Everything that used to be always-visible in the old EndScreen report, now
 * collapsed by default behind a native <details> disclosure — no animation,
 * so it respects the app's existing reduced-motion support for free.
 */
export default function SessionDetails({ session, analysis }) {
  const { facts } = analysis
  const distractionLog = Array.isArray(session.distractionLog) ? session.distractionLog : []
  const tags = Array.isArray(session.tags) ? session.tags : []
  const energyNote = energyInterpretation(facts.energyLevel, analysis.measurement.aboveThresholdPct)
  const hasAnything = Object.values(facts.phases.seconds || {}).some(s => s > 0) ||
    facts.activity || facts.output || distractionLog.length > 0 || tags.length > 0 || facts.energyLevel

  if (!hasAnything) return null

  return (
    <details style={{ width: '100%', boxSizing: 'border-box' }}>
      <summary style={{
        cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em', padding: '4px 0',
      }}>
        Details
      </summary>
      <div style={{
        marginTop: 12, display: 'flex', flexDirection: 'column', gap: 20,
        background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14,
        padding: '16px 18px',
      }}>
        {facts.energyLevel && (
          <div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 4px' }}>
              Energy: {ENERGY_LABELS[facts.energyLevel] || facts.energyLevel}
            </p>
            {energyNote && (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45, margin: 0 }}>{energyNote}</p>
            )}
          </div>
        )}
        {analysis.measurement.aboveThresholdPct != null && (
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Time above threshold</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
              {analysis.measurement.aboveThresholdPct}% of measured time sat above the focus threshold — a different
              question from the average score, and reported separately for that reason.
            </p>
          </div>
        )}
        <PhaseBreakdown phaseSeconds={facts.phases.seconds || {}} />
        <ActivityAlignment activity={facts.activity} sessionIntent={session.sessionIntent} />
        <OutputEvidence output={facts.output} />
        <DistractionLog distractionLog={distractionLog} />
        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tags.map(tag => (
              <span key={tag} style={{
                padding: '4px 12px', borderRadius: 100,
                background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
                color: '#6366f1', fontSize: 12, fontWeight: 500,
              }}>{tag}</span>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}
