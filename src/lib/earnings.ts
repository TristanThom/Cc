/** Turns the text recognised in an earnings screenshot into draft income entries for review. */

export interface OcrLine {
  text: string
  x: number
  y: number
  w: number
  h: number
}

export interface OcrResult {
  width: number
  height: number
  lines: OcrLine[]
}

export type EarningsKind = 'platform' | 'bonus' | 'tips'

export interface EarningsRow {
  label: string
  amount: number
  kind: EarningsKind
  /** Pre-ticked in the review sheet. */
  selected: boolean
}

export interface EarningsGroup {
  platform: 'Uber' | 'Lyft' | null
  /** Month (1-12) and day shown on the screen, when there is one. */
  date: { month: number; day: number } | null
  total: number | null
  rows: EarningsRow[]
}

const MONEY = /^\$\s?(\d{1,3}(?:,\d{3})*\.\d{2})$/
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DATE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})$/i

const LABELS: { re: RegExp; label: string; kind: EarningsKind }[] = [
  { re: /^net fare$/i, label: 'Net fare', kind: 'platform' },
  { re: /^fares?$/i, label: 'Fare', kind: 'platform' },
  { re: /^(promotions?|bonus(es)?|quests?|incentives?)$/i, label: 'Promotions', kind: 'bonus' },
  { re: /^tips?$/i, label: 'Tips', kind: 'tips' },
]

const amountOf = (l: OcrLine): number | null => {
  const m = MONEY.exec(l.text.trim())
  return m ? Number(m[1].replace(/,/g, '')) : null
}

function parseGroup(lines: OcrLine[], width: number): EarningsGroup | null {
  const money = lines.map((l) => ({ l, amount: amountOf(l) })).filter((m): m is { l: OcrLine; amount: number } => m.amount !== null)
  if (money.length === 0) return null
  const all = lines.map((l) => l.text).join('\n')

  const platform = /\blyft\b/i.test(all) ? 'Lyft' : /\buber\b|net fare/i.test(all) || (/promotions/i.test(all) && /\btrips\b/i.test(all)) ? 'Uber' : null

  // The headline total is the amount set in the largest type.
  const biggest = money.reduce((a, b) => (b.l.h > a.l.h ? b : a))
  const others = money.filter((m) => m !== biggest).map((m) => m.l.h).sort((a, b) => a - b)
  const typical = others.length ? others[Math.floor(others.length / 2)] : 0
  const total = !others.length || biggest.l.h >= typical * 1.25 ? biggest.amount : null

  // A labelled breakdown: the amount sits just below its label, left-aligned with it.
  const rows: EarningsRow[] = []
  for (const l of lines) {
    const spec = LABELS.find((s) => s.re.test(l.text.trim()))
    if (!spec) continue
    const below = money
      .filter((m) => m.l.y > l.y && m.l.y - l.y < l.h * 4 && Math.abs(m.l.x - l.x) < l.h * 3)
      .sort((a, b) => a.l.y - b.l.y)[0]
    if (below && !rows.some((r) => r.kind === spec.kind && r.amount === below.amount)) {
      rows.push({ label: spec.label, amount: below.amount, kind: spec.kind, selected: true })
    }
  }

  const sum = rows.reduce((a, r) => a + r.amount, 0)
  if (total !== null && (rows.length === 0 || Math.abs(sum - total) > 0.02)) {
    // No breakdown, or one that does not add up to the headline: trust the headline.
    rows.forEach((r) => (r.selected = false))
    rows.unshift({ label: 'Total', amount: total, kind: 'platform', selected: true })
  }
  if (rows.length === 0) return null

  // The date being viewed is the one nearest the middle; a "< Nov 13" back chip sits at the edge.
  const mid = lines.length ? Math.min(...lines.map((l) => l.x)) + (Math.max(...lines.map((l) => l.x + l.w)) - Math.min(...lines.map((l) => l.x))) / 2 : width / 2
  const dates = lines
    .map((l) => ({ l, m: DATE.exec(l.text.trim()) }))
    .filter((d): d is { l: OcrLine; m: RegExpExecArray } => d.m !== null && Number(d.m[2]) >= 1 && Number(d.m[2]) <= 31)
    .sort((a, b) => Math.abs(a.l.x + a.l.w / 2 - mid) - Math.abs(b.l.x + b.l.w / 2 - mid))
  const date = dates.length ? { month: MONTHS.indexOf(dates[0].m[1].toLowerCase().slice(0, 3)) + 1, day: Number(dates[0].m[2]) } : null

  return { platform, date, total, rows }
}

/**
 * One group per app shown. A wide screenshot (two apps side by side on an unfolded phone)
 * is read as a left half and a right half.
 */
export function parseEarnings(ocr: OcrResult): EarningsGroup[] {
  const lines = ocr.lines.filter((l) => l.text.trim() !== '')
  if (ocr.width > ocr.height * 1.05) {
    const half = ocr.width / 2
    const left = parseGroup(lines.filter((l) => l.x + l.w / 2 < half), half)
    const right = parseGroup(lines.filter((l) => l.x + l.w / 2 >= half), half)
    if (left && right) return [left, right]
  }
  const whole = parseGroup(lines, ocr.width)
  return whole ? [whole] : []
}

/** The most recent occurrence of a month/day at or before `now`, at local noon. */
export function resolveDate(d: { month: number; day: number } | null, now: number): number {
  const n = new Date(now)
  if (!d) return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12).getTime()
  const thisYear = new Date(n.getFullYear(), d.month - 1, d.day, 12).getTime()
  return thisYear <= now + 86_400_000 ? thisYear : new Date(n.getFullYear() - 1, d.month - 1, d.day, 12).getTime()
}
