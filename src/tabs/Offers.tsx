import { ArrowDown, Check, Clock, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Btn, Card, cx, Pill, Segmented } from '../components/ui'
import { fmtDate, fmtTime, money } from '../lib/engine'
import { isNative } from '../lib/native'
import { loadOffers, offerMiles, offerMinutes, offerStats, perMile, type Offer, type OfferOutcome } from '../lib/offers'
import { useStore } from '../lib/store'

type Filter = 'all' | OfferOutcome

const OUTCOME: Record<OfferOutcome, { label: string; chip: string; Icon: typeof Check }> = {
  accepted: { label: 'Accepted', chip: 'bg-go-dark text-white', Icon: Check },
  declined: { label: 'Declined', chip: 'bg-stop text-white', Icon: X },
  missed: { label: 'Missed', chip: 'bg-bg-2 text-ink', Icon: Clock },
}
const APP_NAME = { lyft: 'Lyft', uber: 'Uber' } as const
const mi = (n: number) => (n > 0 && n < 0.1 ? '<0.1' : n.toFixed(1))
const PAGE = 50

export default function Offers() {
  const platforms = useStore((s) => s.platforms)
  const [offers, setOffers] = useState<Offer[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [shown, setShown] = useState(PAGE)

  const refresh = useCallback(() => {
    loadOffers()
      .then(setOffers)
      .catch(() => setOffers([]))
  }, [])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 10_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [refresh])

  if (offers === null) return null
  if (offers.length === 0) {
    return (
      <Card className="space-y-2 p-6 text-center text-sm font-bold text-ink-2">
        <p className="text-base font-black text-ink">No ride offers logged yet</p>
        {isNative ? (
          <p>Turn on offer tracking in Settings, then drive as normal. Each Lyft offer appears here with its fare, distances and whether you took it. Uber offers aren't logged yet.</p>
        ) : (
          <p>Offer tracking runs in the Waypoint Android app, where it reads ride offers from the Lyft driver app.</p>
        )}
      </Card>
    )
  }

  const stats = offerStats(offers)
  const list = filter === 'all' ? offers : offers.filter((o) => o.outcome === filter)
  const colorOf = (o: Offer) => platforms.find((p) => p.name === APP_NAME[o.app])?.color ?? '#334155'

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="grid grid-cols-4 divide-x-2 divide-ink text-center">
          {(
            [
              ['Offers', String(stats.total), ''],
              ['Accepted', String(stats.accepted), 'text-go-text'],
              ['Declined', String(stats.declined), 'text-stop-text'],
              ['Missed', String(stats.missed), ''],
            ] as const
          ).map(([label, value, tone]) => (
            <div key={label} className="px-1 py-3">
              <div className="text-[10px] font-extrabold uppercase tracking-wide text-ink-2">{label}</div>
              <div className={cx('num text-2xl font-black', tone)}>{value}</div>
            </div>
          ))}
        </div>
        <p className="num border-t-2 border-ink px-4 py-2 text-xs font-bold text-ink-2">
          Acceptance rate {stats.acceptRate.toFixed(0)}% · Lyft only for now · Missed = timed out or taken away
        </p>
      </Card>

      <Segmented
        label="Offer filter"
        value={filter}
        onChange={(f) => (setFilter(f), setShown(PAGE))}
        options={[
          { value: 'all', label: 'All' },
          { value: 'accepted', label: 'Accepted' },
          { value: 'declined', label: 'Declined' },
          { value: 'missed', label: 'Missed' },
        ]}
      />

      {list.length === 0 && <Card className="p-8 text-center text-sm font-bold text-ink-2">No {filter} offers.</Card>}

      <ol className="space-y-3">
        {list.slice(0, shown).map((o) => {
          const out = OUTCOME[o.outcome] ?? OUTCOME.missed
          const pm = perMile(o)
          return (
            <li key={o.id}>
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between gap-2 border-b-2 border-ink bg-bg-2 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Pill color={colorOf(o)}>{o.rideType && o.rideType !== APP_NAME[o.app] ? `${APP_NAME[o.app]} · ${o.rideType}` : APP_NAME[o.app]}</Pill>
                    <span className="truncate text-xs font-bold text-ink-2">
                      {fmtDate(o.t)} · {fmtTime(o.t)}
                    </span>
                  </div>
                  <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-ink px-2 py-0.5 text-[11px] font-black uppercase tracking-wide', out.chip)}>
                    <out.Icon size={12} strokeWidth={4} /> {out.label}
                  </span>
                </div>
                <div className="space-y-3 p-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="num text-3xl font-black leading-none">{money(o.fare)}</div>
                      {o.bonus > 0 && <div className="num mt-1 text-xs font-bold text-ink-2">incl. {money(o.bonus)} bonus</div>}
                    </div>
                    <div className="num text-right text-sm font-black">
                      {pm !== null && <div>{money(pm)}/mi</div>}
                      {o.hourly > 0 && <div className="text-ink-2">{money(o.hourly)}/hr est.</div>}
                    </div>
                  </div>
                  <div className="space-y-1 text-sm font-bold">
                    <Leg label="Pickup" min={o.pickupMin} miles={o.pickupMi} place={o.pickup} />
                    <ArrowDown size={14} strokeWidth={3} className="ml-1 text-ink-2" aria-hidden />
                    <Leg label="Trip" min={o.tripMin} miles={o.tripMi} place={o.dropoff} />
                  </div>
                  <p className="num text-xs font-bold text-ink-2">
                    Total {offerMinutes(o)} min · {mi(offerMiles(o))} mi
                    {o.queued && ' · offered during a ride'}
                    {o.tags.length > 0 && ` · ${o.tags.join(' · ')}`}
                  </p>
                </div>
              </Card>
            </li>
          )
        })}
      </ol>
      {list.length > shown && (
        <Btn className="w-full" onClick={() => setShown(shown + PAGE)}>
          Show {Math.min(PAGE, list.length - shown)} more
        </Btn>
      )}
    </div>
  )
}

function Leg({ label, min, miles, place }: { label: string; min: number; miles: number; place: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-14 shrink-0 text-[10px] font-extrabold uppercase tracking-wide text-ink-2">{label}</span>
      <span className="min-w-0">
        <span className="num block font-black">
          {min} min · {mi(miles)} mi
        </span>
        {place && <span className="block text-ink-2">{place}</span>}
      </span>
    </div>
  )
}
