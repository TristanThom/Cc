import { Fuel } from 'lucide-react'
import { money, num } from '../lib/engine'
import type { FuelSummary } from '../lib/receipt'
import { useStore } from '../lib/store'
import type { FuelSplit } from '../lib/types'
import { Card, Segmented } from './ui'

const EXPLAIN: Record<FuelSplit, string> = {
  ratio: 'Fuel is shared between business and personal driving by the miles logged in this period. Only the business share counts in your expenses and net profit.',
  business: 'All fuel counts as a business expense.',
  none: 'Fuel is tracked here but left out of your expenses and net profit.',
}

/** Fuel spend for the period and how much of it counts as a business cost, by the driver's chosen rule. */
export default function FuelCard({ fuel, businessMiles, personalMiles }: { fuel: FuelSummary; businessMiles: number; personalMiles: number }) {
  const mode = useStore((s) => s.settings.fuelSplit ?? 'ratio')
  const unit = useStore((s) => s.settings.unit)
  const setFuelSplit = useStore((s) => s.setFuelSplit)
  if (fuel.total <= 0) return null
  const pct = Math.round(fuel.businessShare * 100)
  return (
    <Card className="overflow-hidden">
      <h2 className="flex items-center gap-2 border-b-2 border-ink bg-bg-2 px-4 py-2 text-base font-black">
        <Fuel size={20} strokeWidth={2.5} /> Fuel
      </h2>
      <div className="space-y-3 p-4">
        <Segmented
          label="How fuel counts"
          value={mode}
          onChange={setFuelSplit}
          options={[
            { value: 'ratio', label: 'By miles' },
            { value: 'business', label: 'All business' },
            { value: 'none', label: "Don't count" },
          ]}
        />
        <p className="text-xs font-semibold text-ink-2">{EXPLAIN[mode]}</p>

        <div className="grid grid-cols-3 gap-2 text-center">
          <Tile label="Fuel bought" value={money(fuel.total)} />
          <Tile label={`Business ${pct}%`} value={money(fuel.business)} tone="text-go-text" />
          <Tile label={`Personal ${100 - pct}%`} value={money(fuel.personal)} />
        </div>
        <div className="flex h-5 overflow-hidden rounded-full border-2 border-ink bg-bg-2" role="img" aria-label={`${pct}% business, ${100 - pct}% personal`}>
          <div className="bg-go-dark" style={{ width: `${pct}%` }} />
        </div>
        <p className="num text-xs font-bold text-ink-2">
          {num(businessMiles)} business {unit} · {num(personalMiles)} personal {unit}
          {fuel.costPerBusinessMile !== null && ` · ${money(fuel.costPerBusinessMile)} fuel per business ${unit}`}
          {fuel.mpg !== null && ` · ${fuel.mpg.toFixed(1)} ${unit === 'mi' ? 'mpg' : 'km/gal'}`}
        </p>
      </div>
    </Card>
  )
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border-2 border-line px-1 py-2">
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-ink-2">{label}</div>
      <div className={`num text-lg font-black ${tone ?? ''}`}>{value}</div>
    </div>
  )
}
