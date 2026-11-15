import { describe, expect, it } from 'vitest'
import type { OcrLine } from './earnings'
import { ALL_TIME } from './engine'
import { fuelSummary, isFuel, parseReceipt } from './receipt'
import type { Txn } from './types'

const line = (text: string, x: number, y: number, h = 30): OcrLine => ({ text, x, y, w: text.length * h * 0.55, h })
const page = (lines: OcrLine[]) => ({ width: 800, height: 1600, lines })

describe('receipt reading', () => {
  it('reads a printed gas receipt: total, gallons, price, date, merchant', () => {
    const r = parseReceipt(
      page([
        line('QUIK STOP #142', 240, 40, 36),
        line('123 Main St, Springfield', 200, 90),
        line('11/14/2026  9:42 PM', 60, 180),
        line('PUMP# 07', 60, 240),
        line('REGULAR UNLEADED', 60, 290),
        line('GALLONS', 60, 340),
        line('9.412', 600, 340),
        line('PRICE/GAL', 60, 390),
        line('$2.899', 600, 390),
        line('FUEL SALE', 60, 440),
        line('$27.29', 600, 440),
        line('SUBTOTAL', 60, 500),
        line('$27.29', 600, 500),
        line('TOTAL', 60, 550, 36),
        line('$27.29', 600, 550, 36),
        line('VISA ************1234', 60, 620),
      ]),
    )
    expect(r).toMatchObject({ total: 27.29, gallons: 9.412, pricePerGallon: 2.899, date: { year: 2026, month: 11, day: 14 }, merchant: 'QUIK STOP #142', kind: 'fuel' })
  })

  it('prefers the grand total over a subtotal and tax, on one line or two', () => {
    const r = parseReceipt(page([line('SPARKLE CAR WASH', 200, 40), line('Deluxe wash', 60, 200), line('15.00', 600, 200), line('Subtotal 15.00', 60, 260), line('Tax 1.05', 60, 310), line('Total $16.05', 60, 360), line('02/03/26', 60, 430)]))
    expect(r).toMatchObject({ total: 16.05, kind: 'wash', gallons: null, date: { year: 2026, month: 2, day: 3 } })
  })

  it('works out gallons from total and price when only those are readable', () => {
    const r = parseReceipt(page([line('Pump 4', 60, 100), line('$3.199/gal', 60, 200), line('Total', 60, 300), line('$32.00', 500, 300)]))
    expect(r.gallons).toBeCloseTo(10.003, 3)
    expect(r.kind).toBe('fuel')
  })

  it('falls back to the largest amount, and gives up cleanly on an unreadable photo', () => {
    expect(parseReceipt(page([line('PARKING GARAGE B', 100, 40), line('2 hr', 60, 200), line('8.00', 500, 200), line('Paid 10.00', 60, 260)])).total).toBe(10)
    expect(parseReceipt(page([line('blurry', 10, 10)]))).toMatchObject({ total: null, date: null, gallons: null, kind: null })
  })
})

describe('fuel split between business and personal miles', () => {
  const fuel = (amount: number, gallons?: number): Txn => ({ id: String(amount), vehicleId: 'v', type: 'expense', category: 'Fuel / Gas', amount, ts: 1000, note: '', gallons })
  const txns = [fuel(30, 10), fuel(20, 6), { ...fuel(15), category: 'Car Wash' }, { ...fuel(99), vehicleId: 'other' }]

  it('recognises fuel by category or by having gallons', () => {
    expect(isFuel(fuel(30))).toBe(true)
    expect(isFuel({ ...fuel(30, 9), category: 'Custom' })).toBe(true)
    expect(isFuel({ ...fuel(30), category: 'Car Wash' })).toBe(false)
  })

  it('shares fuel by miles, counts it all as business, or leaves it out', () => {
    const ratio = fuelSummary(txns, 'v', ALL_TIME, 300, 100, 'ratio')
    expect(ratio).toMatchObject({ total: 50, gallons: 16, business: 37.5, personal: 12.5, businessShare: 0.75 })
    expect(ratio.costPerBusinessMile).toBeCloseTo(0.125, 6)
    expect(ratio.mpg).toBeCloseTo(25, 6)
    expect(fuelSummary(txns, 'v', ALL_TIME, 300, 100, 'business')).toMatchObject({ business: 50, personal: 0 })
    expect(fuelSummary(txns, 'v', ALL_TIME, 300, 100, 'none')).toMatchObject({ business: 0, personal: 50, costPerBusinessMile: null })
  })

  it('keeps fuel as business when no miles are logged to split by', () => {
    expect(fuelSummary(txns, 'v', ALL_TIME, 0, 0, 'ratio')).toMatchObject({ business: 50, personal: 0, mpg: null })
  })
})
