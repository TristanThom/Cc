import { Timer } from 'lucide-react'
import { useMemo } from 'react'
import { fmtDuration, money, num, type Period } from '../lib/engine'
import { hoursSummary } from '../lib/hours'
import { useStore } from '../lib/store'
import { Card, cx } from './ui'

/**
 * Shift time against the apps' own online time for the selected period.
 *
 * Shift hourly (all income over Waypoint shift time) is the accurate hourly figure. Each app
 * also gets its own online hourly. Online times are added together for comparison with the
 * shift, but never used for a combined hourly, since an hour on both apps counts twice.
 */
export default function HoursCard({ vehicleId, period, now, businessMiles }: { vehicleId: string; period: Period; now: number; businessMiles: number }) {
  const stats = useStore((s) => s.stats)
  const shifts = useStore((s) => s.shifts)
  const txns = useStore((s) => s.txns)
  const unit = useStore((s) => s.settings.unit)
  const h = useMemo(() => hoursSummary(stats ?? [], shifts, txns, vehicleId, period, now), [stats, shifts, txns, vehicleId, period, now])

  if (h.shiftMin < 1 && h.apps.length === 0) return null
  const longest = Math.max(h.shiftMin, h.totalOnlineMin ?? 0, 1)
  const bookedMi = h.apps.reduce((a, x) => a + (x.bookedMi ?? 0), 0)

  return (
    <Card className="overflow-hidden">
      <h2 className="flex items-center gap-2 border-b-2 border-ink bg-bg-2 px-4 py-2 text-base font-black">
        <Timer size={20} strokeWidth={2.5} /> Shift time vs online time
      </h2>
      <div className="grid grid-cols-2 divide-x-2 divide-ink border-b-2 border-ink text-center">
        <div className="px-2 py-3">
          <div className="text-[11px] font-extrabold uppercase tracking-wide text-ink-2">Shift time</div>
          <div className="num text-2xl font-black">{fmtDuration(h.shiftMin)}</div>
        </div>
        <div className="bg-go-soft px-2 py-3">
          <div className="text-[11px] font-extrabold uppercase tracking-wide text-ink-2">Shift hourly</div>
          <div className="num text-2xl font-black text-go-text">{h.shiftHourly !== null ? `${money(h.shiftHourly)}/hr` : '—'}</div>
        </div>
      </div>

      {h.apps.length === 0 ? (
        <p className="px-4 py-4 text-sm font-semibold text-ink-2">Import your Uber and Lyft stats screenshots for this period to compare their online time with your shift time.</p>
      ) : (
        <div className="space-y-4 p-4">
          {h.totalOnlineMin !== null && (
            <div>
              <Bar label="Shift time" minutes={h.shiftMin} of={longest} tone="bg-ink" />
              <Bar label="Online, all apps" minutes={h.totalOnlineMin} of={longest} tone="bg-amber" />
              {h.totalOnlineMin > h.shiftMin + 1 && h.shiftMin >= 1 && (
                <p className="mt-1 text-xs font-semibold text-ink-2">Online time is more than shift time because an hour with two apps on counts for both.</p>
              )}
              {h.totalOnlineMin < h.shiftMin - 1 && <p className="mt-1 text-xs font-semibold text-ink-2">{fmtDuration(h.shiftMin - h.totalOnlineMin)} of your shift had no app online, or isn't covered by the stats imported.</p>}
            </div>
          )}

          <ul className="space-y-3">
            {h.apps.map((a) => (
              <li key={a.app} className="rounded-xl border-2 border-ink p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-base font-black">{a.app}</h3>
                  <span className="num text-base font-black text-go-text">{a.onlineHourly !== null ? `${money(a.onlineHourly)}/online hr` : a.earnings !== null ? money(a.earnings) : ''}</span>
                </div>
                <dl className="num mt-2 grid grid-cols-1 gap-y-1 text-sm font-bold sm:grid-cols-2 sm:gap-x-6">
                  {a.onlineMin !== null && <Fact k="Online" v={fmtDuration(a.onlineMin)} />}
                  {a.shiftMin >= 1 && <Fact k="Shift in those days" v={fmtDuration(a.shiftMin)} />}
                  {a.onlineMin !== null && a.shiftMin >= 1 && <Fact k="Online share of shift" v={`${Math.round((a.onlineMin / a.shiftMin) * 100)}%`} />}
                  {a.bookedMin !== null && <Fact k="Booked" v={fmtDuration(a.bookedMin)} />}
                  {a.bookedMin !== null && a.onlineMin ? <Fact k="Booked share of online" v={`${Math.round((a.bookedMin / a.onlineMin) * 100)}%`} /> : null}
                  {a.earnings !== null && <Fact k="Earnings" v={money(a.earnings)} />}
                  {a.tips !== null && <Fact k="Tips" v={money(a.tips)} />}
                  {a.trips !== null && <Fact k="Trips" v={String(a.trips)} />}
                  {a.rejected !== null && <Fact k="Rejected" v={String(a.rejected)} />}
                  {a.bookedMi !== null && <Fact k={`Booked ${unit}`} v={String(Math.round(a.bookedMi * 10) / 10)} />}
                </dl>
              </li>
            ))}
          </ul>
          {bookedMi > 0 && businessMiles > 0 && (
            <p className="num text-xs font-bold text-ink-2">
              {num(bookedMi)} booked {unit} out of {num(businessMiles)} business {unit} logged ({Math.round((bookedMi / businessMiles) * 100)}% paid), for the apps that report booked distance.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

function Bar({ label, minutes, of, tone }: { label: string; minutes: number; of: number; tone: string }) {
  return (
    <div className="mb-1.5">
      <div className="num flex justify-between text-xs font-extrabold">
        <span>{label}</span>
        <span>{fmtDuration(minutes)}</span>
      </div>
      <div className="h-4 overflow-hidden rounded-full border-2 border-ink bg-bg-2">
        <div className={cx('h-full', tone)} style={{ width: `${Math.max(2, (minutes / of) * 100)}%` }} />
      </div>
    </div>
  )
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="font-semibold text-ink-2">{k}</dt>
      <dd className="font-black">{v}</dd>
    </div>
  )
}
