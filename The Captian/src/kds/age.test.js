import { describe, expect, it } from 'vitest'
import { ageSeconds, formatAge, urgency } from './age.js'

describe('ticket age', () => {
  it('counts whole seconds and never goes negative', () => {
    const t = '2026-11-13T10:00:00.000Z'
    expect(ageSeconds(t, Date.parse('2026-11-13T10:07:05.900Z'))).toBe(425)
    expect(ageSeconds(t, Date.parse('2026-11-13T09:59:00.000Z'))).toBe(0)
  })

  it('formats minutes and seconds, and hours when needed', () => {
    expect(formatAge(0)).toBe('0:00')
    expect(formatAge(425)).toBe('7:05')
    expect(formatAge(3729)).toBe('1:02:09')
  })

  it('turns amber at 10 minutes and red at 20', () => {
    expect(urgency(599)).toBe('ok')
    expect(urgency(600)).toBe('warn')
    expect(urgency(1199)).toBe('warn')
    expect(urgency(1200)).toBe('late')
  })
})
