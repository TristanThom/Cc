import { describe, expect, it } from 'vitest'
import { inPeriod, periodFor, weekLabel, yearPeriod } from './engine'
import { shiftNotice } from './shiftNotice'
import { swipeDirection } from './swipe'

describe('page swipe', () => {
  it('accepts a loose horizontal swipe in either direction', () => {
    expect(swipeDirection(-60, 20)).toBe(1) // finger moves left -> next tab
    expect(swipeDirection(90, -40)).toBe(-1)
  })
  it('ignores taps, short drags and vertical scrolling', () => {
    expect(swipeDirection(0, 0)).toBe(0)
    expect(swipeDirection(-30, 0)).toBe(0)
    expect(swipeDirection(-60, 200)).toBe(0)
    expect(swipeDirection(70, 65)).toBe(0)
  })
})

describe('This Year period and week label', () => {
  const nov11 = Date.UTC(2026, 10, 11, 18)
  it('covers the calendar year in Eastern time', () => {
    const y = yearPeriod(nov11)
    expect(y.label).toBe('2026')
    expect(new Date(y.start).toISOString()).toBe('2026-01-01T05:00:00.000Z')
    expect(new Date(y.end).toISOString()).toBe('2027-01-01T05:00:00.000Z')
    expect(inPeriod(Date.UTC(2026, 0, 1, 4, 59), y)).toBe(false) // still Dec 31 in New York
    expect(inPeriod(Date.UTC(2026, 11, 31, 23), y)).toBe(true)
  })
  it('labels the week by its Monday without changing the week itself', () => {
    const w = periodFor('week', nov11)
    expect(weekLabel(w)).toBe('Week of Nov 9')
    expect(new Date(w.start).toISOString()).toBe('2026-11-09T09:00:00.000Z') // Monday 4:00 AM EST
  })
})

describe('active shift notification', () => {
  const shift = (id: string, startTs: number, endTs: number | null, breakMin = 0) => ({ id, vehicleId: 'v', startOdo: 0, endOdo: endTs === null ? null : 5, startTs, endTs, platforms: ['Uber', 'Lyft'], notes: '', breakMin, breaks: [] })
  it('is absent when no shift is running', () => {
    expect(shiftNotice([shift('a', 1000, 2000)], () => 'Prius')).toBeNull()
  })
  it('describes the most recently started open shift', () => {
    const n = shiftNotice([shift('a', 1000, null), shift('b', 5000, null, 30), shift('c', 9000, 9500)], () => 'Prius')
    expect(n).toMatchObject({ startTs: 5000, breakMin: 30, title: 'Shift active · Prius' })
    expect(n!.text).toContain('30m break')
    expect(n!.text).toContain('Uber, Lyft')
  })
})
