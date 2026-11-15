/** Turns the text recognised in earnings and stats screenshots into drafts for review. */

export interface OcrLine {
  text: string
  x: number
  y: number
  w: number
  h: number
}

/** A single word, with the colour of its text (#rrggbb) when the reader could sample it. */
export interface OcrWord extends OcrLine {
  color?: string
}

export interface OcrResult {
  width: number
  height: number
  lines: OcrLine[]
  words?: OcrWord[]
}

export interface EarningsStats {
  onlineMin?: number
  bookedMin?: number
  bookedMi?: number
  trips?: number
  rejected?: number
  tipRides?: number
}

/** What one screenshot (or one half of a side-by-side one) says about one app. */
export interface EarningsGroup {
  platform: 'Uber' | 'Lyft' | null
  period: 'day' | 'week'
  /** Month (1-12) and day shown on the screen, when there is one. */
  date: { month: number; day: number } | null
  /** Total paid for the period, tips included; null when the screen does not show it reliably. */
  total: number | null
  tips: number | null
  /** Parts of the total, when the screen lists them. */
  netFare: number | null
  promotions: number | null
  stats: EarningsStats
}

const MONEY = /^\$\s?(\d{1,3}(?:,\d{3})*\.\d{2})$/
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DATE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})$/i
const WEEKDAY = /^(mon|tue|wed|thu|fri|sat|sun)$/i
/** Uber's week header, e.g. "Nov 9 - Nov 16". */
const RANGE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\s*[-–—]\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}/i

/** True for text drawn in a colour (Uber's highlighted day), false for white, grey or black. */
function isColoured(hex: string | undefined): boolean {
  const m = hex ? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) : null
  if (!m) return false
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16))
  const max = Math.max(r, g, b)
  return max > 80 && (max - Math.min(r, g, b)) / max > 0.25
}
// Lyft's drill-down sheets sit on top of the day screen and hide half of its total.
const SHEET = /^(Driving|Tip|Earnings) stats$/

const money = (t: string): number | null => {
  const m = MONEY.exec(t.trim())
  return m ? Number(m[1].replace(/,/g, '')) : null
}
const int = (t: string): number | null => (/^\d{1,4}$/.test(t.trim()) ? Number(t.trim()) : null)
const miles = (t: string): number | null => {
  const m = /^(\d{1,4}(?:[.,]\d{1,2})?)\s*mi$/i.exec(t.trim())
  return m ? Number(m[1].replace(',', '.')) : null
}
/** "3 hr 56 min", "11 h 6 m", "45 min", "2 hr" -> minutes. */
export function parseDuration(t: string): number | null {
  const m = /^(?:(\d{1,3})\s*h(?:rs?|ours?)?)?\s*(?:(\d{1,3})\s*m(?:ins?|inutes?)?)?$/i.exec(t.trim())
  if (!m || (m[1] === undefined && m[2] === undefined)) return null
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)
}

const cy = (l: OcrLine) => l.y + l.h / 2

/**
 * The value belonging to a label: either on the same row to its right (Lyft's lists, where
 * the value sits level with the label or its description), or directly below it (Uber's
 * stacked stats). `read` decides whether a line is the right kind of value.
 */
function valueFor<T>(label: OcrLine, lines: OcrLine[], read: (t: string) => T | null): T | null {
  let best: { v: T; score: number } | null = null
  for (const l of lines) {
    if (l === label) continue
    const v = read(l.text)
    if (v === null) continue
    const right = l.x >= label.x + label.w * 0.9 && cy(l) >= label.y - label.h * 0.5 && cy(l) <= label.y + label.h * 3.2
    const below = l.y > label.y && l.y - label.y < label.h * 4 && Math.abs(l.x - label.x) < label.h * 3
    if (!right && !below) continue
    const score = Math.abs(cy(l) - cy(label)) + (right ? 0 : label.h * 10) // same row wins
    if (!best || score < best.score) best = { v, score }
  }
  return best ? best.v : null
}

function parseGroup(lines: OcrLine[], words: OcrWord[], width: number): EarningsGroup | null {
  const all = lines.map((l) => l.text).join('\n')
  const find = (re: RegExp) => lines.find((l) => re.test(l.text.trim()))
  const sheet = lines.some((l) => SHEET.test(l.text.trim()))

  const platform = /\blyft\b/i.test(all) || sheet ? 'Lyft' : /\buber\b|net fare/i.test(all) || (/promotions/i.test(all) && /\btrips\b/i.test(all)) ? 'Uber' : null
  // Uber's week screen: a "Nov 9 - Nov 16" header over a bar per weekday. With no bar
  // selected it shows the week; tapping a day highlights its label and shows that day.
  const range = lines.map((l) => RANGE.exec(l.text.trim())).find((m) => m !== null) ?? null
  const dayTokens = (words.length ? words : lines).filter((w) => WEEKDAY.test(w.text.trim()))
  const weekScreen = range !== null || dayTokens.length >= 3
  const highlighted = dayTokens.filter((w) => isColoured((w as OcrWord).color))
  const selected = weekScreen && highlighted.length === 1 ? highlighted[0] : null
  const period = weekScreen && !selected ? 'week' : 'day'

  const g: EarningsGroup = { platform, period, date: null, total: null, tips: null, netFare: null, promotions: null, stats: {} }

  // ---- labelled values
  const labelled = <T>(re: RegExp, read: (t: string) => T | null): T | null => {
    const l = find(re)
    return l ? valueFor(l, lines, read) : null
  }
  const set = <K extends keyof EarningsStats>(k: K, v: number | null) => {
    if (v !== null) g.stats[k] = v
  }
  set('onlineMin', labelled(/^online( time)?$/i, parseDuration))
  set('bookedMin', labelled(/^booked time$/i, parseDuration))
  set('bookedMi', labelled(/^booked miles$/i, miles))
  set('trips', labelled(/^(rides completed|rides|trips)$/i, int))
  set('rejected', labelled(/^rides rejected$/i, int))
  g.netFare = labelled(/^net fare$/i, money)
  g.promotions = labelled(/^(promotions?|bonus(es)?|quests?|incentives?)$/i, money)

  // Tips: "Tip $84.00" (Uber), "$14.79 from 6 rides" or a "TIP STATS" tile (Lyft), and on
  // Lyft's driving stats a bare count of tipped rides.
  const tipLabel = find(/^tips?$/i)
  if (tipLabel) {
    g.tips = valueFor(tipLabel, lines, money)
    if (g.tips === null) set('tipRides', valueFor(tipLabel, lines, int))
  }
  for (const l of lines) {
    const m = /^(?:\$\s?(\d{1,4}\.\d{2})\s+)?from\s+(\d{1,3})\s+rides?$/i.exec(l.text.trim())
    if (!m) continue
    g.stats.tipRides = Number(m[2])
    const amount = m[1] !== undefined ? Number(m[1]) : (lines.map((x) => ({ x, v: money(x.text) })).filter((c) => c.v !== null && c.x.x < l.x && Math.abs(cy(c.x) - cy(l)) < Math.max(c.x.h, l.h)).sort((a, b) => b.x.x - a.x.x)[0]?.v ?? null)
    if (amount !== null) g.tips = amount
  }
  const tipTile = find(/^tip stats?$/i)
  if (g.tips === null && tipTile && !sheet) {
    g.tips = valueFor(tipTile, lines, money)
    const rides = valueFor(tipTile, lines, (t) => /^(\d{1,3}) rides?$/i.exec(t.trim())?.[1] ?? null)
    if (rides !== null) g.stats.tipRides = Number(rides)
  }

  // ---- headline total: the amount in the largest type, unless it is a rate or the tips figure
  const rateLines = lines.filter((l) => /booked hr/i.test(l.text))
  const amounts = lines
    .map((l) => ({ l, v: money(l.text) }))
    .filter((m): m is { l: OcrLine; v: number } => m.v !== null)
    .filter((m) => !rateLines.some((r) => Math.abs(cy(r) - cy(m.l)) < m.l.h * 1.6 && r.x >= m.l.x - m.l.h))
  if (!sheet && amounts.length) {
    const biggest = amounts.reduce((a, b) => (b.l.h > a.l.h ? b : a))
    const others = amounts.filter((m) => m !== biggest).map((m) => m.l.h).sort((a, b) => a - b)
    const typical = others.length ? others[Math.floor(others.length / 2)] : 0
    if ((!others.length || biggest.l.h >= typical * 1.25) && biggest.v !== g.tips) g.total = biggest.v
  }
  // A full breakdown is a better total than a headline that may be cut off at the top.
  if (g.netFare !== null && g.tips !== null) {
    const sum = Math.round((g.netFare + (g.promotions ?? 0) + g.tips) * 100) / 100
    if (g.total === null || Math.abs(sum - g.total) > 0.02) g.total = sum
  }

  // ---- the date being viewed is nearest the middle; a "< Nov 13" back chip sits at the edge
  const xs = lines.map((l) => l.x)
  const mid = lines.length ? Math.min(...xs) + (Math.max(...lines.map((l) => l.x + l.w)) - Math.min(...xs)) / 2 : width / 2
  const dates = lines
    .map((l) => ({ l, m: DATE.exec(l.text.trim()) }))
    .filter((d): d is { l: OcrLine; m: RegExpExecArray } => d.m !== null && Number(d.m[2]) >= 1 && Number(d.m[2]) <= 31)
    // On a sheet the date sits under the title at the left, so position says nothing there.
    .sort((a, b) => (sheet ? a.l.y - b.l.y : Math.abs(a.l.x + a.l.w / 2 - mid) - Math.abs(b.l.x + b.l.w / 2 - mid)))
  if (dates.length) g.date = { month: MONTHS.indexOf(dates[0].m[1].toLowerCase().slice(0, 3)) + 1, day: Number(dates[0].m[2]) }
  if (range) {
    const start = { month: MONTHS.indexOf(range[1].toLowerCase().slice(0, 3)) + 1, day: Number(range[2]) }
    g.date = start
    if (selected) {
      // The day number sits just above the highlighted weekday; find it within the week.
      const above = (words.length ? words : lines)
        .filter((w) => /^\d{1,2}$/.test(w.text.trim()) && w.y < selected.y && selected.y - w.y < selected.h * 3 && Math.abs(w.x + w.w / 2 - (selected.x + selected.w / 2)) < selected.h * 2)
        .sort((a, b) => b.y - a.y)[0]
      const year = new Date().getFullYear()
      for (let i = 0; above && i < 8; i++) {
        const d = new Date(year, start.month - 1, start.day + i)
        if (d.getDate() === Number(above.text.trim())) g.date = { month: d.getMonth() + 1, day: d.getDate() }
      }
    }
  }

  const empty = g.total === null && g.tips === null && Object.keys(g.stats).length === 0
  return empty ? null : g
}

/**
 * One group per app shown. A wide screenshot (two apps side by side on an unfolded phone)
 * is read as a left half and a right half.
 */
export function parseEarnings(ocr: OcrResult): EarningsGroup[] {
  const lines = ocr.lines.filter((l) => l.text.trim() !== '')
  const words = (ocr.words ?? []).filter((l) => l.text.trim() !== '')
  if (ocr.width > ocr.height * 1.05) {
    const half = ocr.width / 2
    const left = parseGroup(lines.filter((l) => l.x + l.w / 2 < half), words.filter((l) => l.x + l.w / 2 < half), half)
    const right = parseGroup(lines.filter((l) => l.x + l.w / 2 >= half), words.filter((l) => l.x + l.w / 2 >= half), half)
    if (left && right) return [left, right]
  }
  const whole = parseGroup(lines, words, ocr.width)
  return whole ? [whole] : []
}

/**
 * Combines groups from several screenshots that describe the same app, period and date.
 * Later screenshots fill in what earlier ones lacked; a disagreement on the total is reported.
 */
export function mergeGroups(groups: EarningsGroup[]): { groups: EarningsGroup[]; conflicts: string[] } {
  const out: EarningsGroup[] = []
  const conflicts: string[] = []
  for (const g of groups) {
    const same = out.find((o) => o.platform === g.platform && o.period === g.period && (o.date?.month ?? 0) === (g.date?.month ?? 0) && (o.date?.day ?? 0) === (g.date?.day ?? 0))
    if (!same) {
      out.push({ ...g, stats: { ...g.stats } })
      continue
    }
    if (same.total !== null && g.total !== null && Math.abs(same.total - g.total) > 0.005) {
      conflicts.push(`${g.platform ?? 'One app'} shows two different totals (${same.total.toFixed(2)} and ${g.total.toFixed(2)}); check the amount.`)
    }
    same.total = same.total ?? g.total
    same.tips = same.tips ?? g.tips
    same.netFare = same.netFare ?? g.netFare
    same.promotions = same.promotions ?? g.promotions
    same.stats = { ...g.stats, ...same.stats }
  }
  return { groups: out, conflicts }
}

/** The most recent occurrence of a month/day at or before `now`, at local noon. */
export function resolveDate(d: { month: number; day: number } | null, now: number): number {
  const n = new Date(now)
  if (!d) return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12).getTime()
  const thisYear = new Date(n.getFullYear(), d.month - 1, d.day, 12).getTime()
  return thisYear <= now + 86_400_000 ? thisYear : new Date(n.getFullYear() - 1, d.month - 1, d.day, 12).getTime()
}
