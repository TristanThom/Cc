import { ArrowLeft, ArrowRight, Gauge, Play, Route, ShieldCheck, UserRound } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { currentOdo, fmtRate, num } from '../lib/engine'
import { toast, useStore } from '../lib/store'
import { PlatformGrid } from '../tabs/Home'
import { VehicleFields } from '../tabs/Settings'
import { Btn, cx, ErrorText } from './ui'

const STEPS = ['Vehicle', 'Platforms', 'Start']

export default function Onboarding() {
  const { unit, rate } = useStore((s) => s.settings)
  const vehicles = useStore((s) => s.vehicles)
  const shifts = useStore((s) => s.shifts)
  const { addVehicle, updateVehicle, startShift, finishOnboarding } = useStore.getState()
  const existing = vehicles[0]
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [f, setF] = useState({ year: existing?.year ?? '', make: existing?.make ?? '', model: existing?.model ?? '', plate: existing?.plate ?? '', startOdo: existing ? String(existing.startOdo) : '' })
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setF({ ...f, [k]: k === 'startOdo' || k === 'year' ? raw.replace(/\D/g, '').slice(0, k === 'year' ? 4 : 7) : raw })
    setErr(null)
  }
  const go = (n: number) => {
    setDir(n > step ? 1 : -1)
    setStep(n)
    setErr(null)
  }

  const next = () => {
    if (step === 0) {
      if (!f.model.trim()) return setErr('Enter your vehicle model — it’s how the car appears in the switcher.')
      if (f.startOdo === '') return setErr('Enter the odometer reading on your dash.')
      const data = { year: f.year, make: f.make.trim(), model: f.model.trim(), plate: f.plate.trim().toUpperCase(), startOdo: Number(f.startOdo) }
      const e = existing ? updateVehicle(existing.id, data) : (addVehicle(data), null)
      if (e) return setErr(e)
    }
    go(step + 1)
  }
  const finish = (start: boolean) => {
    const v = useStore.getState().vehicles[0]
    if (start && v) {
      const e = startShift(v.id, currentOdo(v, shifts))
      if (e) return setErr(e)
      toast('First shift started — drive safe')
    }
    finishOnboarding()
  }

  const explain = [
    { Icon: Play, bg: 'bg-amber', t: 'Start & end shifts', d: 'Enter the odometer when you go online and again when you stop. That’s the only logging you do.' },
    { Icon: UserRound, bg: 'bg-bg-2', t: 'Personal gaps fill themselves in', d: 'Anything driven between one shift’s end and the next shift’s start is auto-logged as a non-deductible Personal Gap.' },
    { Icon: ShieldCheck, bg: 'bg-emerald-100', t: 'Unbroken chain, live write-off', d: `Zero unaccounted ${unit === 'mi' ? 'miles' : 'kilometres'}. Business distance × ${fmtRate(rate)}/${unit} updates your tax write-off instantly.` },
  ]

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col px-4 pb-4 pt-5">
      <div className="mb-1 flex items-center gap-2 text-2xl font-black">
        <span className="num rounded-lg bg-ink px-2 py-0.5 text-amber">00</span> Welcome to Waypoint
      </div>
      <p className="text-sm font-semibold text-ink-2">Three quick steps and every mile is accounted for.</p>
      <ol className="my-4 grid grid-cols-3 gap-2" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className={cx('rounded-xl border-2 border-ink px-2 py-2 text-center text-xs font-extrabold', i < step ? 'bg-go-dark text-white' : i === step ? 'bg-amber' : 'bg-white text-ink-2')}>
            <span className="num">{i + 1}.</span> {s}
          </li>
        ))}
      </ol>

      <div className="relative flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ x: dir * 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir * -60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            className="space-y-4 rounded-2xl border-2 border-ink bg-white p-4"
          >
            {step === 0 && (
              <>
                <h2 className="flex items-center gap-2 text-lg font-black">
                  <Gauge size={22} strokeWidth={2.5} /> Your vehicle &amp; odometer
                </h2>
                <VehicleFields f={f} set={set} unit={unit} />
              </>
            )}
            {step === 1 && (
              <>
                <p className="text-sm font-semibold text-ink-2">Pick the apps you drive for. You can change these any time from Home, and add your own.</p>
                <PlatformGrid bare />
              </>
            )}
            {step === 2 && (
              <>
                <h2 className="flex items-center gap-2 text-lg font-black">
                  <Route size={22} strokeWidth={2.5} /> How continuous tracking works
                </h2>
                <ul className="space-y-3">
                  {explain.map(({ Icon, bg, t, d }) => (
                    <li key={t} className="flex gap-3">
                      <span className={cx('grid size-12 shrink-0 place-items-center rounded-xl border-2 border-ink', bg)}>
                        <Icon size={22} strokeWidth={2.5} />
                      </span>
                      <span className="text-sm font-semibold text-ink-2">
                        <b className="block text-base font-extrabold text-ink">{t}</b>
                        {d}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="num flex items-center gap-1 text-[11px] font-black" aria-hidden>
                  <span className="flex-[3] rounded-md bg-go-dark py-1.5 text-center text-white">SHIFT</span>
                  <span className="flex-1 rounded-md border-2 border-dashed border-ink-2 py-1 text-center text-ink-2">GAP</span>
                  <span className="flex-[4] rounded-md bg-go-dark py-1.5 text-center text-white">SHIFT</span>
                  <span className="flex-1 rounded-md border-2 border-dashed border-ink-2 py-1 text-center text-ink-2">GAP</span>
                  <span className="flex-[2] rounded-md bg-go-dark py-1.5 text-center text-white">SHIFT</span>
                </div>
                <p className="num text-center text-sm font-extrabold">
                  Chain starts at {num(Number(f.startOdo) || 0)} {unit}
                </p>
              </>
            )}
            <ErrorText>{err}</ErrorText>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-4 space-y-2">
        {step < 2 ? (
          <div className="flex gap-2">
            {step > 0 && (
              <Btn big onClick={() => go(step - 1)} aria-label="Back">
                <ArrowLeft size={22} strokeWidth={3} />
              </Btn>
            )}
            <Btn tone="amber" big className="flex-1" onClick={next}>
              Continue <ArrowRight size={22} strokeWidth={3} />
            </Btn>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <Btn big onClick={() => go(1)} aria-label="Back">
                <ArrowLeft size={22} strokeWidth={3} />
              </Btn>
              <Btn tone="amber" big className="flex-1" onClick={() => finish(true)}>
                <Play size={22} strokeWidth={3} fill="currentColor" /> Start First Shift
              </Btn>
            </div>
            <Btn className="w-full" onClick={() => finish(false)}>
              Not driving yet — go to dashboard
            </Btn>
          </>
        )}
      </div>
    </div>
  )
}
