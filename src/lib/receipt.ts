import type { OcrLine, OcrResult } from './earnings'
import { inPeriod, type Period } from './engine'
import type { FuelSplit, Txn } from './types'

/** What a receipt or pump photo says, as far as it could be read. Every field is a suggestion to confirm. */
export interface ReceiptDraft {
  total: number | null
  /** Local date as month/day/year, when printed. */
  date: { year: number; month: number; day: number } | null
  merchant: string
  gallons: number | null
  pricePerGallon: number | null
  /** A guess at the expense category, matched against the driver's categories by the UI. */
  kind: 'fuel' | 'wash' | 'toll' | 'maintenance' | null
}

const AMOUNT = /\$?\s?(\d{1,4}(?:,\d{3})*[.,]\d{2})(?!\d)/
const num = (s: string) => Number(s.replace(/,(?=\d{3})/g, '').replace(',', '.'))
const cy = (l: OcrLine) => l.y + l.h / 2

/** An amount on the same row as `label` (to its right), else just below it. */
function amountNear(label: OcrLine, lines: OcrLine[]): number | null {
  const own = AMOUNT.exec(label.text.replace(/^.*?(total|due|sale|amount)\b/i, ''))
  if (own) return num(own[1])
  const c = lines
    .filter((l) => l !== label && AMOUNT.test(l.text))
    .map((l) => ({ l, row: Math.abs(cy(l) - cy(label)) < label.h * 0.9 && l.x > label.x, below: l.y > label.y && l.y - label.y < label.h * 2.5 }))
    .filter((x) => x.row || x.below)
    .sort((a, b) => Number(b.row) - Number(a.row) || a.l.y - b.l.y)[0]
  return c ? num(AMOUNT.exec(c.l.text)![1]) : null
}

export function parseReceipt(ocr: OcrResult): ReceiptDraft {
  const lines = ocr.lines.filter((l) => l.text.trim() !== '').sort((a, b) => a.y - b.y || a.x - b.x)
  const all = lines.map((l) => l.text).join('\n')
  const d: ReceiptDraft = { total: null, date: null, merchant: '', gallons: null, pricePerGallon: null, kind: null }

  // ---- total: a line that says so (never "subtotal"), else the largest amount printed
  const labelled = lines
    .filter((l) => /\b(total|amount due|balance due|fuel sale|sale)\b/i.test(l.text) && !/sub\s*-?total|total (gal|vol)|gallons/i.test(l.text))
    .map((l) => ({ l, v: amountNear(l, lines), strong: /\btotal\b|amount due|balance due/i.test(l.text) }))
    .filter((x): x is { l: OcrLine; v: number; strong: boolean } => x.v !== null)
  // The last strong label wins: receipts print the grand total after any running totals.
  const pick = labelled.filter((x) => x.strong).pop() ?? labelled.pop()
  if (pick) d.total = pick.v
  else {
    const amounts = lines.map((l) => AMOUNT.exec(l.text)).filter((m): m is RegExpExecArray => m !== null).map((m) => num(m[1]))
    if (amounts.length) d.total = Math.max(...amounts)
  }

  // ---- fuel: gallons and price per gallon
  const gal = /(\d{1,2}[.,]\d{2,3})\s*(?:gal(?:lons?)?|g)\b/i.exec(all) ?? /(?:gallons?|volume|gal)\s*[:=]?\s*(\d{1,2}[.,]\d{2,3})/i.exec(all)
  if (gal) d.gallons = num(gal[1])
  const ppg = /\$?\s?(\d[.,]\d{2,3})\s*\/\s*(?:gal|g)\b/i.exec(all) ?? /(?:price\s*\/?\s*(?:per\s*)?(?:gal(?:lon)?|g)|unit price|ppg)\s*[:=]?\s*\$?\s?(\d[.,]\d{2,3})/i.exec(all)
  if (ppg) d.pricePerGallon = num(ppg[1])
  // Two of total, gallons and price give the third.
  if (d.gallons === null && d.total !== null && d.pricePerGallon) d.gallons = Math.round((d.total / d.pricePerGallon) * 1000) / 1000
  if (d.pricePerGallon === null && d.total !== null && d.gallons) d.pricePerGallon = Math.round((d.total / d.gallons) * 1000) / 1000

  // ---- date
  const md = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b/.exec(all)
  if (md) {
    const year = md[3].length === 2 ? 2000 + Number(md[3]) : Number(md[3])
    const month = Number(md[1])
    const day = Number(md[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2015 && year <= 2100) d.date = { year, month, day }
  }

  // ---- merchant: the first line near the top that reads like a name
  const name = lines.find((l) => l.y < ocr.height * 0.35 && /[A-Za-z]{3,}/.test(l.text) && !/receipt|welcome|thank|invoice|\d{3}[-.\s]\d{4}/i.test(l.text) && l.text.trim().length <= 32)
  if (name) d.merchant = name.text.trim()

  d.kind = d.gallons !== null || /\b(unleaded|regular|premium|diesel|fuel|pump\s*#?\s*\d|gasoline)\b/i.test(all) ? 'fuel' : /car\s*wash/i.test(all) ? 'wash' : /\b(toll|parking|garage)\b/i.test(all) ? 'toll' : /\b(oil change|tire|brake|auto parts|lube)\b/i.test(all) ? 'maintenance' : null
  return d
}

/* ------------------------------------------------------------------ */
/* Fuel cost, split between business and personal driving              */
/* ------------------------------------------------------------------ */

export const isFuel = (t: Txn) => t.type === 'expense' && (t.gallons !== undefined || /\b(fuel|gas|gasoline|diesel|charging)\b/i.test(t.category))

export interface FuelSummary {
  total: number
  gallons: number
  /** Share of fuel counted as a business cost under the chosen rule. */
  business: number
  personal: number
  businessShare: number // 0..1
  /** Business fuel per business mile, and miles per gallon over all miles; null without data. */
  costPerBusinessMile: number | null
  mpg: number | null
}

export function fuelSummary(txns: Txn[], vehicleId: string, p: Period, businessMiles: number, personalMiles: number, mode: FuelSplit): FuelSummary {
  const fuel = txns.filter((t) => t.vehicleId === vehicleId && isFuel(t) && inPeriod(t.ts, p))
  const total = fuel.reduce((a, t) => a + t.amount, 0)
  const gallons = fuel.reduce((a, t) => a + (t.gallons ?? 0), 0)
  const miles = businessMiles + personalMiles
  // With no miles logged there is nothing to split by, so the whole amount stays business.
  const businessShare = mode === 'business' ? 1 : mode === 'none' ? 0 : miles > 0 ? businessMiles / miles : 1
  const business = Math.round(total * businessShare * 100) / 100
  return {
    total,
    gallons,
    business,
    personal: Math.round((total - business) * 100) / 100,
    businessShare,
    costPerBusinessMile: businessMiles > 0 && business > 0 ? business / businessMiles : null,
    mpg: gallons > 0 && miles > 0 ? miles / gallons : null,
  }
}
