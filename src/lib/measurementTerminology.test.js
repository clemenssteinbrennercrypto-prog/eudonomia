import { describe, expect, it } from 'vitest'
import { NATIVE_CAMERA_MEASUREMENT_V2, WEBVIEW_CAMERA_MEASUREMENT } from './cameraMeasurement'
import { measurementMethodLabel, measurementSourceLabel } from './measurementTerminology'

describe('measurement terminology', () => {
  it('uses descriptive product language for known camera methods', () => {
    expect(measurementMethodLabel(NATIVE_CAMERA_MEASUREMENT_V2.attentionScoringVersion)).toBe('Current camera measurement')
    expect(measurementMethodLabel(WEBVIEW_CAMERA_MEASUREMENT.attentionScoringVersion)).toBe('Earlier camera measurement')
    expect(measurementSourceLabel(NATIVE_CAMERA_MEASUREMENT_V2.id, 2)).toBe('Current camera measurement')
    expect(measurementSourceLabel(WEBVIEW_CAMERA_MEASUREMENT.id, 1)).toBe('Earlier camera measurement')
  })

  it('keeps unknown and missing metadata understandable without version jargon', () => {
    expect(measurementMethodLabel(99)).toBe('Compatible camera measurement')
    expect(measurementSourceLabel('future_source', 99)).toBe('Stored camera measurement')
    expect(measurementSourceLabel(null, null)).toBe('Measurement method not stored')
  })
})
