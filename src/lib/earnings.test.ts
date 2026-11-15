import { describe, expect, it } from 'vitest'
import { parseEarnings, resolveDate, type OcrLine } from './earnings'

const line = (text: string, x: number, y: number, h = 36): OcrLine => ({ text, x, y, w: text.length * h * 0.55, h })

/** Layout of an Uber weekly earnings screen: headline total, stats, labelled breakdown. */
const uber = (dx = 0): OcrLine[] => [
  line('$456.12', 380 + dx, 0, 70),
  line('$330.97', 16 + dx, 110, 34),
  line('9', 114 + dx, 390),
  line('Mon', 90 + dx, 430),
  line('Stats', 30 + dx, 535, 48),
  line('Online', 30 + dx, 645),
  line('Trips', 498 + dx, 645),
  line('11 h 6 m', 30 + dx, 695),
  line('53', 498 + dx, 695),
  line('Breakdown', 30 + dx, 1005, 48),
  line('Net Fare', 60 + dx, 1108),
  line('$354.31', 60 + dx, 1160, 32),
  line('Promotions', 60 + dx, 1262),
  line('$17.81', 60 + dx, 1314, 32),
  line('Tip', 60 + dx, 1416),
  line('$84.00', 60 + dx, 1468, 32),
]

/** Layout of a Lyft daily earnings screen: date, headline total, rides, stat tiles. */
const lyft = (dx = 0): OcrLine[] => [
  line('< Nov 13', 1060 + dx, 132),
  line('Nov 14', 1446 + dx, 132),
  line('$181.22', 1195 + dx, 255, 120),
  line('$6.37 Lyft', 1138 + dx, 472),
  line('incl. $1.72 bonus', 1138 + dx, 522),
  line('2:09 AM', 1802 + dx, 498),
  line('Your daily stats', 1036 + dx, 988, 44),
  line('EARNINGS', 1116 + dx, 1104),
  line('$42.31', 1065 + dx, 1228, 48),
  line('per booked hr', 1065 + dx, 1290),
  line('Rides rejected', 1440 + dx, 1290),
  line('13', 1708 + dx, 1290),
  line('$14.79', 1815 + dx, 1184, 48),
  line('$479.08 Balance', 1036 + dx, 1392),
]

describe('earnings screenshot parsing', () => {
  it('splits an Uber breakdown that adds up to the headline', () => {
    const [g] = parseEarnings({ width: 1000, height: 1510, lines: uber() })
    expect(g.platform).toBe('Uber')
    expect(g.total).toBe(456.12)
    expect(g.date).toBeNull()
    expect(g.rows).toEqual([
      { label: 'Net fare', amount: 354.31, kind: 'platform', selected: true },
      { label: 'Promotions', amount: 17.81, kind: 'bonus', selected: true },
      { label: 'Tips', amount: 84, kind: 'tips', selected: true },
    ])
  })

  it('falls back to the headline when the breakdown does not add up', () => {
    const lines = uber().filter((l) => l.text !== 'Tip' && l.text !== '$84.00') // scrolled off screen
    const [g] = parseEarnings({ width: 1000, height: 1510, lines })
    expect(g.rows[0]).toEqual({ label: 'Total', amount: 456.12, kind: 'platform', selected: true })
    expect(g.rows.slice(1).every((r) => !r.selected)).toBe(true)
  })

  it('reads a Lyft daily total and its date, ignoring ride rows and stat tiles', () => {
    const [g] = parseEarnings({ width: 1000, height: 1510, lines: lyft(-1000) })
    expect(g.platform).toBe('Lyft')
    expect(g.date).toEqual({ month: 11, day: 14 })
    expect(g.rows).toEqual([{ label: 'Total', amount: 181.22, kind: 'platform', selected: true }])
  })

  it('reads both apps from one side-by-side screenshot', () => {
    const groups = parseEarnings({ width: 2000, height: 1510, lines: [...uber(), ...lyft()] })
    expect(groups.map((g) => g.platform)).toEqual(['Uber', 'Lyft'])
    expect(groups[0].rows).toHaveLength(3)
    expect(groups[1].rows[0].amount).toBe(181.22)
  })

  it('returns nothing for an image with no amounts', () => {
    expect(parseEarnings({ width: 1000, height: 1500, lines: [line('Hello', 10, 10), line('Rides 21', 10, 80)] })).toEqual([])
  })

  it('resolves a month/day to the most recent past date', () => {
    const now = new Date(2026, 10, 15, 9).getTime()
    expect(new Date(resolveDate({ month: 11, day: 14 }, now)).toDateString()).toBe(new Date(2026, 10, 14).toDateString())
    expect(new Date(resolveDate({ month: 12, day: 30 }, now)).getFullYear()).toBe(2025)
    expect(new Date(resolveDate(null, now)).toDateString()).toBe(new Date(2026, 10, 15).toDateString())
  })
})
