import { FOCUSED_SCORE } from '../../../lib/attention'
import { buildScoreComponentSummary } from '../../../lib/analyticsModel'
import { SCORE_COMPONENT_LABELS } from '../../../lib/attentionScore'
import { describeConclusion, describeNextAction, fmtDuration } from '../../../lib/sessionAnalysisPresentation'
import { measurementSourceLabel } from '../../../lib/measurementTerminology'

function bandFor(average) {
  if (average == null) return null
  if (average >= 70) return { id: 'high', label: 'High', rule: 'average ≥ 70' }
  if (average < 50) return { id: 'low', label: 'Low', rule: 'average < 50' }
  return { id: 'mixed', label: 'Mixed', rule: '50 ≤ average < 70' }
}

function formatEvidence(evidence = {}) {
  return Object.entries(evidence).map(([key, value]) => {
    if (typeof value === 'number') return `${key}=${Number.isInteger(value) ? value : value.toFixed(1)}`
    return `${key}=${String(value)}`
  }).join(' · ')
}

function sourceLabel(measurement) {
  return measurementSourceLabel(measurement.measurementSource, measurement.scoringVersion)
}

export default function WhyThisResult({ session, analysis }) {
  const { measurement } = analysis
  const band = bandFor(measurement.averageFocus)
  const read = describeConclusion(analysis.conclusion, analysis.facts)
  const action = describeNextAction(analysis.nextAction)
  const canReconstructMean = Number.isFinite(session.scoreSum) && Number.isFinite(measurement.measuredSeconds) && measurement.measuredSeconds > 0
  const aboveThresholdFormula = measurement.focusedSeconds != null && measurement.measuredSeconds
    ? `${Math.round(measurement.focusedSeconds)}s / ${Math.round(measurement.measuredSeconds)}s = ${measurement.aboveThresholdPct}%`
    : null
  const scoreComponents = buildScoreComponentSummary([session])
  const tracedSamples = (Array.isArray(session.timeline) ? session.timeline : [])
    .filter(sample => sample?.scoreTrace?.version)
  const latestTrace = tracedSamples.at(-1)?.scoreTrace || null

  return (
    <section className="analytics-why" aria-labelledby="why-result-heading">
      <div className="analytics-section-heading">
        <div>
          <span className="analytics-kicker">Decision trace</span>
          <h2 id="why-result-heading">Why this result?</h2>
        </div>
        <b>Current analysis</b>
      </div>

      <ol className="analytics-reason-chain">
        <li>
          <span>01</span>
          <div>
            <strong>Measurement</strong>
            <p>{sourceLabel(measurement)} · {measurement.measuredSeconds == null ? 'no measured time' : `${fmtDuration(measurement.measuredSeconds)} measured of ${fmtDuration(measurement.actualSeconds)} active`}.</p>
            {session.attentionModel?.landmarkModelSha256 && (
              <details>
                <summary>Model identity</summary>
                <code>landmark {session.attentionModel.landmarkModelSha256}</code>
                {session.attentionModel.detectorModelSha256 && <code>detector {session.attentionModel.detectorModelSha256}</code>}
              </details>
            )}
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>Session average</strong>
            {measurement.averageFocus == null ? (
              <p>No average was reported because this session has no valid focus measurement.</p>
            ) : canReconstructMean ? (
              <p>{Math.round(session.scoreSum)} accumulated score-seconds / {Math.round(measurement.measuredSeconds)} measured seconds = <b>{measurement.averageFocus}%</b>.</p>
            ) : (
              <p>The stored session average is <b>{measurement.averageFocus}%</b>. This record predates the raw score accumulator, so the numerator cannot be reconstructed.</p>
            )}
            {aboveThresholdFormula && <p>{aboveThresholdFormula} of measured time was at or above the fixed per-second focus threshold ({FOCUSED_SCORE}).</p>}
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>Conclusion rule</strong>
            {analysis.status === 'awaiting_outcome' ? (
              <p>No conclusion: the goal outcome is still unrated.</p>
            ) : analysis.status === 'facts_only' ? (
              <p>No conclusion: the session was shorter than the 120-second evidence floor.</p>
            ) : (
              <>
                <p>{band ? `${band.label} attention (${band.rule})` : 'No attention band'} + outcome <b>{analysis.goalOutcome}</b> → <code>{analysis.conclusion?.code}</code>.</p>
                {read && <p>{read.headline}</p>}
                {analysis.conclusion?.evidence && <small>{formatEvidence(analysis.conclusion.evidence)}</small>}
              </>
            )}
          </div>
        </li>
        <li>
          <span>04</span>
          <div>
            <strong>Next-action rule</strong>
            {action ? (
              <>
                <p>{action}</p>
                <small><code>{analysis.nextAction.code}</code>{analysis.nextAction.evidence && ` · ${formatEvidence(analysis.nextAction.evidence)}`}</small>
              </>
            ) : (
              <p>No action is selected until the session supports a conclusion.</p>
            )}
          </div>
        </li>
      </ol>

      {scoreComponents.traceSamples > 0 ? (
        <div className="analytics-score-trace">
          <div className="analytics-section-heading">
            <div>
              <span className="analytics-kicker">Score ledger</span>
              <h2>What changed the score</h2>
            </div>
            <b>{scoreComponents.traceSamples} traced samples</b>
          </div>
          <p className="analytics-footnote">Average delta is shown only when a component was active. Sampling and smoothing mean these rows are an audit trail, not percentages that should add to the session average.</p>
          <div className="analytics-component-table">
            {scoreComponents.components.map(component => (
              <div key={component.id}>
                <span>{SCORE_COMPONENT_LABELS[component.id] || component.id}</span>
                <strong className={component.averageDeltaWhenActive >= 0 ? 'is-positive' : 'is-negative'}>
                  {component.averageDeltaWhenActive > 0 ? '+' : ''}{component.averageDeltaWhenActive}
                </strong>
                <small>{component.activeSharePct}% of traced samples · {component.activeSamples} active</small>
              </div>
            ))}
          </div>
          {latestTrace && (
            <details className="analytics-latest-trace">
              <summary>Inspect latest traced sample</summary>
              <p>Camera {latestTrace.cameraScore?.toFixed?.(1) ?? latestTrace.cameraScore} → after activity {latestTrace.preRampScore?.toFixed?.(1) ?? latestTrace.preRampScore} + ramp {latestTrace.rampBonus?.toFixed?.(1) ?? latestTrace.rampBonus} = raw {latestTrace.rawFinal?.toFixed?.(1) ?? latestTrace.rawFinal}; smoothed with previous {latestTrace.previousScore?.toFixed?.(1) ?? latestTrace.previousScore} → final {latestTrace.finalScore?.toFixed?.(1) ?? latestTrace.finalScore}.</p>
              <code>{JSON.stringify(latestTrace.signals)}</code>
              {latestTrace.heldForUncertainTracking && <p>The final score was held because tracking was uncertain; the unreliable candidate was not accepted.</p>}
            </details>
          )}
        </div>
      ) : (
        <div className="analytics-trace-limit">
          <strong>Trace unavailable for this record</strong>
          <p>This session predates component-level score traces. Its resulting timeline score remains visible, but Analytics does not invent which individual bonuses or penalties produced it.</p>
        </div>
      )}
    </section>
  )
}
