import { Check, CheckCheck, ChevronRight, Flag, Gauge, Play, Plus, Rocket, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { BreakStepper, Btn, Card, cx, ErrorText, Field, inputCls, Keypad, OdometerDrum, PhotoInput, Segmented, Sheet, Swatches } from '../components/ui'
import { SWATCHES } from '../lib/defaults'
import { activeShiftOf, ALL_TIME, buildLedger, chainFloor, currentOdo, fmtClock, fmtDuration, fmtRate, fmtTime, grossMinutes, mileTotals, money, num, periodFor, shiftLengthMin, type Period } from '../lib/engine'
import { toast, useNow, useStore, useVehicle } from '../lib/store'
import type { Shift, Vehicle } from '../lib/types'

type OdoMode = 'check' | 'start' | 'end'

export default function Home() {
  const v = useVehicle()
  const shifts = useStore((s) => s.shifts)
  const [sheet, setSheet] = useState<OdoMode | null>(null)
  if (!v) return null
  const active = activeShiftOf(shifts, v.id)
  const odo = currentOdo(v, shifts)
  const hasShifts = shifts.some((s) => s.vehicleId === v.id)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      <div className="min-w-0 space-y-4">
        {!hasShifts && <SetupGuide odo={odo} onStart={() => setSheet('start')} />}

        <Card className="overflow-hidden">
          <button
            type="button"
            onClick={() => setSheet('check')}
            className="flex w-full flex-col items-center gap-3 px-4 py-5 active:bg-bg-2"
            aria-label={`Current odometer ${num(odo)}. Tap to update or ${active ? 'end' : 'start'} a shift`}
          >
            <span className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-ink-2">
              <Gauge size={16} strokeWidth={3} /> {active ? 'Shift start odometer' : 'Current odometer'}
            </span>
            <OdometerDrum value={odo} />
            <span className="flex items-center gap-1 text-sm font-extrabold text-ink-2">
              Tap to update <ChevronRight size={16} strokeWidth={3} />
            </span>
          </button>
        </Card>

        {active ? <ActiveShiftBar shift={active} onEnd={() => setSheet('end')} /> : (
          <Btn tone="amber" big className="w-full text-2xl" onClick={() => setSheet('start')}>
            <Play size={26} strokeWidth={3} fill="currentColor" /> Start Shift
          </Btn>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        <MetricsCard vehicle={v} />
        <PlatformGrid locked={!!active} />
      </div>

      <OdoSheet mode={sheet} setMode={setSheet} vehicle={v} active={active} />
    </div>
  )
}

/* ---------------------------- FTUE guide --------------------------- */

function SetupGuide({ odo, onStart }: { odo: number; onStart: () => void }) {
  const unit = useStore((s) => s.settings.unit)
  const steps = [
    ['Vehicle saved', `Odometer chain starts at ${num(odo)} ${unit}.`, true],
    ['Pick today’s gig apps', 'Tap the platforms you’re running below.', true],
    ['Start your first shift', 'Confirm the odometer — every mile from here is tracked.', false],
  ] as const
  return (
    <Card className="border-go-dark bg-emerald-50 p-4">
      <h2 className="flex items-center gap-2 text-lg font-black text-go-dark">
        <Rocket size={22} strokeWidth={2.5} /> First-Time Setup Ready
      </h2>
      <ol className="mt-3 space-y-2">
        {steps.map(([t, d, done], i) => (
          <li key={t} className="flex items-start gap-3">
            <span className={cx('num grid size-7 shrink-0 place-items-center rounded-full border-2 border-ink text-sm font-black', done ? 'bg-go-dark text-white' : 'bg-amber')}>
              {done ? <Check size={16} strokeWidth={4} /> : i + 1}
            </span>
            <span className="text-sm font-semibold text-ink-2">
              <b className="block text-base font-extrabold text-ink">{t}</b>
              {d}
            </span>
          </li>
        ))}
      </ol>
      <Btn tone="ink" className="mt-3 w-full" onClick={onStart}>
        Start first shift <ChevronRight size={18} strokeWidth={3} />
      </Btn>
    </Card>
  )
}

/* ------------------------- Active shift bar ------------------------ */

function ActiveShiftBar({ shift, onEnd }: { shift: Shift; onEnd: () => void }) {
  const now = useNow(1000)
  const bump = useStore((s) => s.bumpBreak)
  return (
    <section className="rounded-2xl border-2 border-ink bg-go-dark p-4 text-white shadow-hard" aria-label="Active shift">
      <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest">
        <span className="relative flex size-3 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-70" />
          <span className="relative inline-flex size-3 rounded-full bg-white" />
        </span>
        Shift active · since {fmtTime(shift.startTs)}
      </div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="num text-[clamp(2.25rem,11vw,3rem)] font-black leading-none" aria-label="Elapsed time">
          {fmtClock(now - shift.startTs)}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-white/80">Shift Length</div>
          <div className="num text-2xl font-black">{fmtDuration(shiftLengthMin(shift, now))}</div>
        </div>
      </div>
      <p className="mt-2 truncate text-sm font-bold text-white/90">{shift.platforms.join(' · ') || 'No platform selected'}</p>
      <div className="mt-3 rounded-xl border-2 border-white/60 p-2">
        <BreakStepper dark minutes={shift.breakMin} onBump={(d) => bump(shift.id, d)} />
      </div>
      <button
        type="button"
        onClick={onEnd}
        className="mt-3 flex min-h-16 w-full items-center justify-center gap-2 rounded-xl border-2 border-ink bg-white text-2xl font-black text-ink active:bg-bg-2"
      >
        <Square size={22} strokeWidth={3} fill="currentColor" /> End Shift
      </button>
    </section>
  )
}

/* --------------------------- Metrics card -------------------------- */

function MetricsCard({ vehicle }: { vehicle: Vehicle }) {
  const shifts = useStore((s) => s.shifts)
  const { rate, unit } = useStore((s) => s.settings)
  const [range, setRange] = useState<'week' | 'month' | 'all'>('week')
  const now = useNow(30_000)
  const ledger = useMemo(() => buildLedger(vehicle, shifts), [vehicle, shifts])
  const period: Period = range === 'all' ? ALL_TIME : periodFor(range, now)
  const t = mileTotals(ledger, period, now)
  return (
    <Card>
      <div className="p-3 pb-0">
        <Segmented
          label="Metrics period"
          value={range}
          onChange={setRange}
          options={[
            { value: 'week', label: 'Weekly' },
            { value: 'month', label: 'Monthly' },
            { value: 'all', label: 'All-Time' },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 divide-x-2 divide-ink">
        <div className="p-4">
          <div className="text-xs font-extrabold uppercase tracking-wide text-ink-2">Business Miles</div>
          <div className="num mt-1 text-3xl font-black">
            {num(t.business)}
            <span className="ml-1 text-base text-ink-2">{unit}</span>
          </div>
          <div className="num mt-1 text-xs font-bold text-ink-2">
            {t.shiftCount} shift{t.shiftCount === 1 ? '' : 's'} · {num(t.personal)} personal
          </div>
        </div>
        <div className="bg-emerald-50 p-4">
          <div className="text-xs font-extrabold uppercase tracking-wide text-go-dark">Est. Tax Write-Off</div>
          <div className="num mt-1 text-3xl font-black text-go-dark">{money(t.business * rate)}</div>
          <div className="num mt-1 text-xs font-bold text-ink-2">
            @ {fmtRate(rate)}/{unit} IRS rate
          </div>
        </div>
      </div>
      <p className="border-t-2 border-ink px-4 py-2 text-xs font-bold text-ink-2">{period.mode === 'week' ? `Week of ${period.label} · resets Mon 4:00 AM ET` : period.label}</p>
    </Card>
  )
}

/* -------------------------- Platform grid -------------------------- */

export function PlatformGrid({ locked, bare }: { locked?: boolean; bare?: boolean }) {
  const platforms = useStore((s) => s.platforms)
  const { togglePlatform, setAllPlatforms, addPlatform, removePlatform } = useStore.getState()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(SWATCHES[6])
  const [err, setErr] = useState<string | null>(null)
  const allOn = platforms.length > 0 && platforms.every((p) => p.active)

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-black">Active Gig Platforms</h2>
        <button
          type="button"
          onClick={() => setAllPlatforms(!allOn)}
          aria-pressed={allOn}
          className={cx('inline-flex min-h-12 items-center gap-1.5 rounded-xl border-2 border-ink px-3 text-sm font-extrabold', allOn ? 'bg-ink text-white' : 'bg-white')}
        >
          <CheckCheck size={18} strokeWidth={3} /> Select All
        </button>
      </div>
      {locked && <p className="mt-1 text-xs font-bold text-ink-2">Changes apply to your next shift.</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {platforms.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={p.active}
            onClick={() => togglePlatform(p.id)}
            className={cx(
              'flex min-h-14 items-center gap-2 rounded-xl border-2 border-ink px-3 text-left text-sm font-extrabold transition-colors',
              p.active ? 'text-white' : 'bg-white text-ink',
            )}
            style={p.active ? { background: p.color, textShadow: '0 1px 2px rgba(0,0,0,.55)' } : undefined}
          >
            <span className={cx('grid size-6 shrink-0 place-items-center rounded-md border-2', p.active ? 'border-white bg-white text-ink' : 'border-ink')} style={p.active ? undefined : { background: p.color }}>
              {p.active && <Check size={16} strokeWidth={4} />}
            </span>
            <span className="truncate">{p.name}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex min-h-14 items-center justify-center gap-1 rounded-xl border-2 border-dashed border-ink bg-bg-2 text-sm font-extrabold active:bg-white"
        >
          <Plus size={18} strokeWidth={3} /> Add
        </button>
      </div>
    </>
  )

  return (
    <>
      {bare ? <div>{body}</div> : <Card className="p-4">{body}</Card>}
      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Add custom platform"
        footer={
          <Btn
            tone="amber"
            className="w-full"
            onClick={() => {
              const e = addPlatform(name, color)
              setErr(e)
              if (!e) {
                setName('')
                setAdding(false)
              }
            }}
          >
            <Plus size={20} strokeWidth={3} /> Add platform
          </Btn>
        }
      >
        <Field label="Platform name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shipt, Roadie, Veho" maxLength={24} />
        </Field>
        <Field label="Color">
          <Swatches value={color} onChange={setColor} />
        </Field>
        <ErrorText>{err}</ErrorText>
        {platforms.some((p) => !p.builtin) && (
          <div>
            <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-ink-2">Your custom platforms</div>
            <ul className="space-y-2">
              {platforms.filter((p) => !p.builtin).map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-xl border-2 border-ink p-1 pl-3">
                  <span className="size-4 rounded-full border-2 border-ink" style={{ background: p.color }} />
                  <span className="flex-1 truncate font-extrabold">{p.name}</span>
                  <button type="button" aria-label={`Remove ${p.name}`} onClick={() => removePlatform(p.id)} className="grid size-12 place-items-center rounded-lg text-stop active:bg-red-50">
                    <Trash2 size={20} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Sheet>
    </>
  )
}

/* ---------------------------- Odometer sheet ----------------------- */

function OdoSheet({ mode, setMode, vehicle, active }: { mode: OdoMode | null; setMode: (m: OdoMode | null) => void; vehicle: Vehicle; active?: Shift }) {
  const shifts = useStore((s) => s.shifts)
  const { rate, unit } = useStore((s) => s.settings)
  const { startShift, endShift, setOdoReading, bumpBreak } = useStore.getState()
  const now = useNow(1000)
  const odo = currentOdo(vehicle, shifts)
  const floor = chainFloor(vehicle, shifts)
  const [val, setVal] = useState('')
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<string>()
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (mode) {
      setVal(String(odo))
      setNotes(active?.notes ?? '')
      setPhoto(undefined)
      setErr(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const n = val === '' ? NaN : Number(val)
  const ending = !!active && mode !== null
  const close = () => setMode(null)
  const done = (e: string | null, msg: string) => {
    setErr(e)
    if (!e) {
      toast(msg)
      close()
    }
  }

  const delta = Number.isFinite(n) ? n - (ending ? active.startOdo : floor) : NaN
  const title = ending ? 'End Shift' : mode === 'start' ? 'Start Shift' : 'Odometer'

  return (
    <Sheet
      open={mode !== null}
      onClose={close}
      title={title}
      footer={
        ending ? (
          <Btn tone="go" big className="w-full" disabled={!Number.isFinite(n)} onClick={() => done(endShift(active.id, n, notes.trim(), photo), `Shift saved · ${num(n - active.startOdo)} ${unit} logged`)}>
            <Flag size={22} strokeWidth={3} /> End Shift &amp; Save
          </Btn>
        ) : (
          <>
            <Btn tone="amber" big className="w-full" disabled={!Number.isFinite(n)} onClick={() => done(startShift(vehicle.id, n, photo), 'Shift started — drive safe')}>
              <Play size={22} strokeWidth={3} fill="currentColor" /> Start Shift at {Number.isFinite(n) ? num(n) : '—'}
            </Btn>
            {mode === 'check' && (
              <Btn className="w-full" disabled={!Number.isFinite(n) || n === odo} onClick={() => done(setOdoReading(vehicle.id, n), 'Odometer updated')}>
                <Gauge size={20} strokeWidth={2.5} /> Update odometer only
              </Btn>
            )}
          </>
        )
      }
    >
      <div className="flex flex-col items-center gap-2">
        <span className="text-xs font-extrabold uppercase tracking-widest text-ink-2">{ending ? 'End odometer reading' : 'Odometer reading'}</span>
        <OdometerDrum value={Number.isFinite(n) ? n : 0} size="sm" />
        <p className="num min-h-5 text-center text-sm font-extrabold" aria-live="polite">
          {!Number.isFinite(delta) ? (
            <span className="text-ink-2">Enter the reading on your dash</span>
          ) : delta < 0 ? (
            <span className="text-stop">
              Below {ending ? 'shift start' : 'last logged reading'} ({num(ending ? active.startOdo : floor)})
            </span>
          ) : ending ? (
            <span className="text-go-dark">
              {num(delta)} business {unit} · {money(delta * rate)} write-off
            </span>
          ) : delta === 0 ? (
            <span className="text-ink-2">No personal {unit} since last entry</span>
          ) : (
            <span className="text-ink-2">
              +{num(delta)} {unit} auto-logged as Personal Gap
            </span>
          )}
        </p>
      </div>

      <Keypad value={val} onChange={(x) => (setVal(x), setErr(null))} />
      <ErrorText>{err}</ErrorText>

      {ending && (
        <>
          <div className="rounded-xl border-2 border-ink p-3">
            <BreakStepper minutes={active.breakMin} onBump={(d) => bumpBreak(active.id, d)} />
            <div className="mt-2 flex items-center justify-between border-t-2 border-dashed border-slate-300 pt-2 text-sm font-bold">
              <span className="text-ink-2">
                Elapsed <span className="num">{fmtDuration(grossMinutes(active, now))}</span>
              </span>
              <span className="num text-base font-black">Shift Length: {fmtDuration(shiftLengthMin(active, now))}</span>
            </div>
          </div>
          <Field label="Notes">
            <textarea className={cx(inputCls, 'py-2')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional — surge, zones, anything worth remembering" maxLength={280} />
          </Field>
        </>
      )}
      <PhotoInput value={photo} onChange={setPhoto} />
    </Sheet>
  )
}
