// A WebView timer is only a wake-up signal, never a clock. macOS may throttle
// background callbacks while the user works in another app, so one callback
// can represent more than one real second. Count the elapsed wall time only
// while a recent camera frame proves that the signal is still alive.

export const ATTENTION_ACCUMULATION_VERSION = 2
export const MAX_MEASUREMENT_SPAN_MS = 3_000

export function measuredSpanSeconds({
  previousAt,
  now,
  lastDeliveredFrameAt,
  maxSpanMs = MAX_MEASUREMENT_SPAN_MS,
}) {
  if (
    !Number.isFinite(previousAt) ||
    !Number.isFinite(now) ||
    !Number.isFinite(lastDeliveredFrameAt) ||
    !Number.isFinite(maxSpanMs) ||
    previousAt <= 0 ||
    lastDeliveredFrameAt <= 0 ||
    now <= previousAt ||
    maxSpanMs <= 0
  ) return 0

  const elapsedMs = now - previousAt
  const frameAgeMs = now - lastDeliveredFrameAt
  if (elapsedMs > maxSpanMs || frameAgeMs < 0 || frameAgeMs > maxSpanMs) return 0
  return elapsedMs / 1000
}
