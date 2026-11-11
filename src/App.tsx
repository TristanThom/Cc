import { BellRing, Check, ChevronDown, DollarSign, Download, History as HistoryIcon, Home as HomeIcon, Settings as SettingsIcon, WifiOff, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ComponentType } from 'react'
import Onboarding from './components/Onboarding'
import { Confirm, cx } from './components/ui'
import { currentOdo, maintState } from './lib/engine'
import { useInstall, useOnline } from './lib/pwa'
import { useStore, useToast, useVehicle } from './lib/store'
import Alerts from './tabs/Alerts'
import History from './tabs/History'
import Home from './tabs/Home'
import Income from './tabs/Income'
import Settings from './tabs/Settings'

const TABS = [
  { id: 'home', label: 'Home', icon: HomeIcon, view: Home },
  { id: 'income', label: 'Income', icon: DollarSign, view: Income },
  { id: 'history', label: 'History', icon: HistoryIcon, view: History },
  { id: 'alerts', label: 'Alerts', icon: BellRing, view: Alerts },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, view: Settings },
] as const satisfies readonly { id: string; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }>; view: ComponentType }[]

const VISIBLE = 3
const clampWin = (i: number) => Math.min(TABS.length - VISIBLE, Math.max(0, i))

export default function App() {
  const onboarded = useStore((s) => s.onboarded)
  const hasVehicle = useStore((s) => s.vehicles.length > 0)
  const simBar = useStore((s) => s.settings.simBar)
  const online = useOnline()
  const [[tab, dir], setNav] = useState<[number, number]>([0, 0])
  const goTab = (i: number) => setNav(([cur]) => [i, i > cur ? 1 : -1])
  const alertCount = useAlertCount()
  const mainRef = useRef<HTMLElement>(null)
  const setup = !onboarded || !hasVehicle

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [tab, setup])
  useEffect(() => {
    if (setup) setNav([0, 0])
  }, [setup])

  const View = TABS[tab].view

  return (
    <div className="flex h-full flex-col">
      {simBar && <SimBar />}
      {!online && (
        <div role="status" className="flex shrink-0 items-center justify-center gap-2 border-b-2 border-ink bg-amber px-3 py-1.5 text-sm font-extrabold">
          <WifiOff size={16} strokeWidth={3} /> Offline — everything still works and saves on this device
        </div>
      )}
      {!setup && <Header tab={tab} goTab={goTab} alertCount={alertCount} />}

      <main ref={mainRef} className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {setup ? (
          <Onboarding />
        ) : (
          <AnimatePresence mode="popLayout" custom={dir} initial={false}>
            <motion.div
              key={tab}
              custom={dir}
              variants={{
                enter: (d: number) => ({ x: d * 80, opacity: 0 }),
                center: { x: 0, opacity: 1 },
                exit: (d: number) => ({ x: d * -80, opacity: 0 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'spring', stiffness: 420, damping: 38, mass: 0.8 }}
              className="mx-auto w-full max-w-5xl px-4 py-4"
            >
              <View />
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {!setup && <BottomNav tab={tab} goTab={goTab} alertCount={alertCount} />}
      <Toast />
    </div>
  )
}

function useAlertCount() {
  const v = useVehicle()
  const shifts = useStore((s) => s.shifts)
  const maint = useStore((s) => s.maint)
  if (!v) return 0
  const odo = currentOdo(v, shifts)
  return maint.filter((m) => m.vehicleId === v.id && maintState(m, odo).status !== 'ok').length
}

/* ------------------------------ Header ----------------------------- */

function Header({ tab, goTab, alertCount }: { tab: number; goTab: (i: number) => void; alertCount: number }) {
  return (
    <header className="sticky top-0 z-30 shrink-0 border-b-2 border-ink bg-white">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
        <div className="flex items-center gap-2 text-xl font-black tracking-tight">
          <span className="num rounded-md bg-ink px-1.5 py-0.5 text-base text-amber">00</span>
          ShiftOdo
        </div>
        <nav className="ml-4 hidden flex-1 gap-1 md:flex" aria-label="Sections">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => goTab(i)}
              aria-current={tab === i ? 'page' : undefined}
              className={cx('relative min-h-12 rounded-xl px-3 text-sm font-extrabold', tab === i ? 'bg-ink text-white' : 'text-ink-2 hover:bg-bg-2')}
            >
              {t.label}
              {t.id === 'alerts' && alertCount > 0 && <span className="num ml-1.5 rounded-full bg-stop px-1.5 text-xs text-white">{alertCount}</span>}
            </button>
          ))}
        </nav>
        <div className="ml-auto">
          <VehicleSwitcher />
        </div>
      </div>
    </header>
  )
}

function VehicleSwitcher() {
  const vehicles = useStore((s) => s.vehicles)
  const select = useStore((s) => s.selectVehicle)
  const v = useVehicle()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  if (!v) return null
  // Model only; a plate is appended solely to tell two identical models apart.
  const label = (x: typeof v) => (vehicles.filter((o) => o.model === x.model).length > 1 && x.plate ? `${x.model} · ${x.plate}` : x.model)
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Vehicle: ${v.model}. Switch vehicle`}
        className="flex min-h-12 max-w-[11rem] items-center gap-2 rounded-xl border-2 border-ink bg-ink px-3 text-sm font-black text-white"
      >
        <span className="truncate">{label(v)}</span>
        <ChevronDown size={18} strokeWidth={3} className={cx('shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-label="Vehicles"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full z-40 mt-2 w-56 origin-top-right overflow-hidden rounded-xl border-2 border-ink bg-white shadow-hard"
          >
            {vehicles.map((x) => (
              <li key={x.id} role="option" aria-selected={x.id === v.id}>
                <button
                  type="button"
                  onClick={() => (select(x.id), setOpen(false))}
                  className={cx('flex min-h-14 w-full items-center justify-between gap-2 px-4 text-left text-base font-black', x.id === v.id ? 'bg-amber' : 'active:bg-bg-2')}
                >
                  <span className="truncate">{label(x)}</span>
                  {x.id === v.id && <Check size={20} strokeWidth={4} className="shrink-0" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ----------------------------- Bottom nav --------------------------- */

function BottomNav({ tab, goTab, alertCount }: { tab: number; goTab: (i: number) => void; alertCount: number }) {
  const [win, setWin] = useState(clampWin(tab - 1))
  // Keep the selected tab inside the 3-tab window, centred when possible.
  useEffect(() => setWin(clampWin(tab - 1)), [tab])
  const hasPrev = win > 0
  const hasNext = win < TABS.length - VISIBLE

  return (
    <nav aria-label="Sections" className="relative shrink-0 border-t-2 border-ink bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="overflow-hidden">
        <motion.div
          className="flex touch-pan-y"
          style={{ width: `${(TABS.length / VISIBLE) * 100}%` }}
          animate={{ x: `${(-win * 100) / TABS.length}%` }}
          transition={{ type: 'spring', stiffness: 400, damping: 36 }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.25}
          dragSnapToOrigin={false}
          onDragEnd={(_, info) => {
            const swipe = info.offset.x + info.velocity.x * 0.2
            if (Math.abs(swipe) < 40) return
            const steps = Math.abs(swipe) > 180 ? 2 : 1
            setWin((w) => clampWin(w + (swipe < 0 ? steps : -steps)))
          }}
        >
          {TABS.map((t, i) => {
            const on = tab === i
            const Icon = t.icon
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => goTab(i)}
                aria-current={on ? 'page' : undefined}
                style={{ width: `${100 / TABS.length}%` }}
                className="relative flex h-16 shrink-0 flex-col items-center justify-center gap-0.5 px-1"
                draggable={false}
              >
                {on && <motion.span layoutId="nav-pill" className="absolute inset-x-2 inset-y-1.5 rounded-xl bg-ink" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <span className={cx('relative', on ? 'text-amber' : 'text-ink-2')}>
                  <Icon size={24} strokeWidth={2.5} />
                  {t.id === 'alerts' && alertCount > 0 && (
                    <span className="num absolute -right-3 -top-1.5 grid min-w-5 place-items-center rounded-full border-2 border-white bg-stop px-1 text-[10px] font-black leading-4 text-white">{alertCount}</span>
                  )}
                </span>
                <span className={cx('relative text-xs font-extrabold', on ? 'text-white' : 'text-ink-2')}>{t.label}</span>
              </button>
            )
          })}
        </motion.div>
      </div>
      {/* edge hints: more tabs this way */}
      {hasPrev && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-white to-transparent" />}
      {hasNext && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-white to-transparent" />}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0.5 flex justify-center gap-1">
        {TABS.map((t, i) => (
          <span key={t.id} className={cx('h-1 rounded-full transition-all', i >= win && i < win + VISIBLE ? 'w-3 bg-ink' : 'w-1 bg-slate-300')} />
        ))}
      </div>
    </nav>
  )
}

/* ---------------------------- Simulator bar ------------------------- */

function SimBar() {
  const onboarded = useStore((s) => s.onboarded)
  const isDemo = useStore((s) => s.isDemo)
  const shiftCount = useStore((s) => s.shifts.length)
  const vehicleCount = useStore((s) => s.vehicles.length)
  const { simulate, setSimBar } = useStore.getState()
  const install = useInstall()
  const [ask, setAsk] = useState<'welcome' | 'empty' | 'demo' | null>(null)
  const current = !onboarded || vehicleCount === 0 ? 'welcome' : shiftCount === 0 ? 'empty' : isDemo ? 'demo' : null
  const hasRealData = !isDemo && (shiftCount > 0 || useStore.getState().txns.length > 0)
  const run = (m: 'welcome' | 'empty' | 'demo') => (hasRealData ? setAsk(m) : simulate(m))
  const opts = [
    ['welcome', '1. Welcome Setup'],
    ['empty', '2. Empty Dashboard'],
    ['demo', '3. Load Demo Data'],
  ] as const
  return (
    <div className="shrink-0 border-b-2 border-ink bg-ink text-white">
      <div className="no-scrollbar mx-auto flex max-w-5xl items-center gap-2 overflow-x-auto px-3 py-1.5">
        <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-amber">Preview</span>
        {opts.map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => run(m)}
            aria-pressed={current === m}
            className={cx('min-h-12 shrink-0 rounded-lg border-2 px-3 text-xs font-extrabold', current === m ? 'border-amber bg-amber text-ink' : 'border-white/50 text-white active:bg-white/10')}
          >
            {label}
          </button>
        ))}
        <span className="flex-1" />
        {install.state !== 'installed' && (
          <button type="button" onClick={install.prompt} className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-lg border-2 border-white/50 px-3 text-xs font-extrabold active:bg-white/10">
            <Download size={16} strokeWidth={3} /> Install App
          </button>
        )}
        <button type="button" onClick={() => setSimBar(false)} aria-label="Hide preview bar (re-enable in Settings)" className="grid size-12 shrink-0 place-items-center rounded-lg active:bg-white/10">
          <X size={18} strokeWidth={3} />
        </button>
      </div>
      <Confirm
        open={ask !== null}
        onClose={() => setAsk(null)}
        title="Replace your data?"
        body="The preview modes overwrite everything currently in the app, including your logged shifts and transactions. Export a backup from Settings first if you want to keep them."
        action="Replace my data"
        onConfirm={() => ask && simulate(ask)}
      />
    </div>
  )
}

/* -------------------------------- Toast ----------------------------- */

function Toast() {
  const t = useToast((s) => s.toast)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 md:bottom-8" aria-live="polite">
      <AnimatePresence>
        {t && (
          <motion.div
            key={t.id}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            className={cx('max-w-md rounded-xl border-2 border-ink px-4 py-3 text-center text-sm font-extrabold shadow-hard', t.tone === 'err' ? 'bg-stop text-white' : 'bg-ink text-white')}
          >
            {t.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
