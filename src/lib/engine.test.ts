import { describe, expect, it } from 'vitest'
import { demoData } from './defaults'
import { adjustBreaks, buildLedger, currentOdo, ledgerCsv, maintState, mileTotals, periodFor, shiftBounds, shiftLengthMin, weekEnd, weekStart, ALL_TIME } from './engine'
import type { Shift, Vehicle } from './types'

const et = (ts: number) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit', hourCycle: 'h23', month: 'short', day: 'numeric' }).format(ts)

describe('payout week boundary (Monday 4:00 AM Eastern)', () => {
  it('always starts Monday 04:00 ET, across DST changes', () => {
    for (let ts = Date.UTC(2025, 0, 1); ts < Date.UTC(2027, 0, 1); ts += 37 * 3_600_000) {
      const start = weekStart(ts)
      expect(et(start)).toMatch(/^Mon, .* 04:00$/)
      expect(start).toBeLessThanOrEqual(ts)
      expect(weekEnd(start)).toBeGreaterThan(ts)
      expect(et(weekEnd(start))).toMatch(/^Mon, .* 04:00$/)
    }
  })
  it('puts Monday 3:59 AM ET in the previous week and 4:00 AM in the new one', () => {
    const mon4 = Date.UTC(2026, 9, 12, 8) // Mon Oct 12 2026 04:00 EDT
    expect(weekStart(mon4)).toBe(mon4)
    expect(weekStart(mon4 - 60_000)).toBe(mon4 - 7 * 86_400_000)
    expect(periodFor('week', mon4).label).toBe('Oct 12 – Oct 19, 2026')
  })
  it('handles the 167h and 169h DST weeks', () => {
    const spring = weekStart(Date.UTC(2026, 2, 5)) // week containing Mar 8 2026
    expect(weekEnd(spring) - spring).toBe(167 * 3_600_000)
    const fall = weekStart(Date.UTC(2026, 9, 29)) // week containing Nov 1 2026
    expect(weekEnd(fall) - fall).toBe(169 * 3_600_000)
  })
})

const v: Vehicle = { id: 'v', year: '2021', make: 'Toyota', model: 'Prius', plate: '', startOdo: 1000 }
const mk = (id: string, startOdo: number, endOdo: number | null, startTs: number, endTs: number | null, breakMin = 0): Shift => ({
  id, vehicleId: 'v', startOdo, endOdo, startTs, endTs, platforms: ['Uber'], notes: '', breakMin, breaks: breakMin ? [{ id: 'b', minutes: breakMin, ts: startTs }] : [],
})
const H = 3_600_000

describe('continuous odometer chain', () => {
  const shifts = [mk('b', 1200, 1300, 10 * H, 14 * H), mk('a', 1010, 1100, 1 * H, 5 * H, 30)]
  it('auto-fills personal gaps so every mile is accounted for', () => {
    const ledger = buildLedger({ ...v, odoReading: 1325 }, shifts)
    expect(ledger.map((e) => [e.kind, e.miles])).toEqual([
      ['gap', 10], ['shift', 90], ['gap', 100], ['shift', 100], ['gap', 25],
    ])
    const t = mileTotals(ledger, ALL_TIME, 20 * H)
    expect(t.business).toBe(190)
    expect(t.personal).toBe(135)
    expect(t.total).toBe(1325 - v.startOdo)
  })
  it('has no trailing gap while a shift is open', () => {
    const ledger = buildLedger(v, [...shifts, mk('c', 1310, null, 16 * H, null)])
    expect(ledger.at(-1)).toMatchObject({ kind: 'shift', miles: 0 })
    expect(currentOdo(v, [...shifts, mk('c', 1310, null, 16 * H, null)])).toBe(1310)
  })
  it('bounds edits by neighbouring shifts', () => {
    expect(shiftBounds(v, shifts, 'a')).toEqual({ min: 1000, max: 1200 })
    expect(shiftBounds(v, shifts, 'b')).toEqual({ min: 1100, max: Infinity })
  })
  it('demo data forms an unbroken chain per vehicle', () => {
    const d = demoData(Date.UTC(2026, 10, 11, 18))
    for (const veh of d.vehicles) {
      const ledger = buildLedger(veh, d.shifts)
      let odo = veh.startOdo
      for (const e of ledger) {
        const [s, en] = e.kind === 'shift' ? [e.shift.startOdo, e.shift.endOdo!] : [e.startOdo, e.endOdo]
        expect(s).toBe(odo)
        expect(en).toBeGreaterThanOrEqual(s)
        odo = en
      }
      expect(odo).toBe(currentOdo(veh, d.shifts))
    }
  })
})

describe('shift length and breaks', () => {
  const s = mk('a', 0, 10, 0, 4 * H, 30)
  it('is gross elapsed minus breaks', () => {
    expect(shiftLengthMin(s, 99 * H)).toBe(210)
    expect(shiftLengthMin(mk('x', 0, null, 0, null, 15), 2 * H)).toBe(105)
  })
  it('steps by 15 and clamps to [0, gross]', () => {
    let id = 0
    const nid = () => `n${id++}`
    const up = adjustBreaks(s, 15, 5 * H, nid)
    expect(up.breakMin).toBe(45)
    expect(up.breaks.reduce((a, b) => a + b.minutes, 0)).toBe(45)
    const down = adjustBreaks({ ...s, ...up }, -15, 5 * H, nid)
    expect(down).toMatchObject({ breakMin: 30 })
    expect(adjustBreaks({ ...s, breakMin: 0, breaks: [] }, -15, 5 * H, nid)).toEqual({ breakMin: 0, breaks: [] })
    expect(adjustBreaks({ ...s, breakMin: 235, breaks: [{ id: 'q', minutes: 235, ts: 0 }] }, 15, 5 * H, nid).breakMin).toBe(240)
  })
})

describe('maintenance + csv', () => {
  it('classifies status', () => {
    const item = { id: 'm', vehicleId: 'v', name: 'Oil', interval: 5000, notifyBefore: 500, lastServiceOdo: 10000 }
    expect(maintState(item, 12000).status).toBe('ok')
    expect(maintState(item, 14500).status).toBe('soon')
    expect(maintState(item, 15000).status).toBe('overdue')
  })
  it('escapes csv cells and formula injection', () => {
    const sh = { ...mk('a', 1000, 1010, 0, H), notes: '=HYPERLINK("x"), hi' }
    const csv = ledgerCsv(v, buildLedger(v, [sh]), 0.7, 'mi', 2 * H)
    expect(csv.split('\r\n')).toHaveLength(2)
    expect(csv).toContain(`"'=HYPERLINK(""x""), hi"`)
    expect(csv).toContain(',7.00,')
  })
})
