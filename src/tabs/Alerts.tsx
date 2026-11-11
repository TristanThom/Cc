import { AlertTriangle, CheckCircle2, Pencil, Plus, RotateCcw, Trash2, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Btn, Card, Confirm, cx, ErrorText, Field, inputCls, Sheet } from '../components/ui'
import { MAINT_PRESETS } from '../lib/defaults'
import { currentOdo, maintState, num, type MaintStatus } from '../lib/engine'
import { toast, useStore, useVehicle } from '../lib/store'
import type { MaintItem } from '../lib/types'

const STYLE: Record<MaintStatus, { bar: string; chip: string; label: string; border: string }> = {
  ok: { bar: 'bg-go-dark', chip: 'bg-go-dark text-white', label: 'OK', border: 'border-ink' },
  soon: { bar: 'bg-amber', chip: 'bg-amber text-ink', label: 'Due Soon', border: 'border-ink' },
  overdue: { bar: 'bg-stop', chip: 'bg-stop text-white', label: 'Overdue', border: 'border-stop' },
}
const ORDER: Record<MaintStatus, number> = { overdue: 0, soon: 1, ok: 2 }

export default function Alerts() {
  const v = useVehicle()
  const shifts = useStore((s) => s.shifts)
  const maint = useStore((s) => s.maint)
  const unit = useStore((s) => s.settings.unit)
  const justChanged = useStore((s) => s.justChanged)
  const [form, setForm] = useState<{ item: MaintItem | null; key: number }>({ item: null, key: 0 })
  const [open, setOpen] = useState(false)
  if (!v) return null
  const odo = currentOdo(v, shifts)
  const items = maint
    .filter((m) => m.vehicleId === v.id)
    .map((m) => ({ m, st: maintState(m, odo) }))
    .sort((a, b) => ORDER[a.st.status] - ORDER[b.st.status] || a.st.remaining - b.st.remaining)
  const count = (s: MaintStatus) => items.filter((i) => i.st.status === s).length
  const show = (item: MaintItem | null) => (setForm((f) => ({ item, key: f.key + 1 })), setOpen(true))

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="grid grid-cols-3 divide-x-2 divide-ink overflow-hidden text-center">
        {(['overdue', 'soon', 'ok'] as MaintStatus[]).map((s) => (
          <div key={s} className="p-3">
            <div className={cx('num mx-auto grid size-10 place-items-center rounded-full border-2 border-ink text-lg font-black', STYLE[s].chip)}>{count(s)}</div>
            <div className="mt-1 text-xs font-extrabold uppercase tracking-wide text-ink-2">{STYLE[s].label}</div>
          </div>
        ))}
      </Card>
      <p className="num text-center text-sm font-bold text-ink-2">
        {v.model} · tracking against {num(odo)} {unit}
      </p>

      {items.length === 0 && <Card className="p-8 text-center text-sm font-bold text-ink-2">No service items yet. Add one to start tracking it against your odometer.</Card>}

      <ul className="grid gap-3 md:grid-cols-2">
        {items.map(({ m, st }) => {
          const s = STYLE[st.status]
          return (
            <li key={m.id}>
              <Card className={cx('p-4', s.border)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-2 truncate text-lg font-black">
                      {st.status === 'ok' ? <CheckCircle2 size={20} className="shrink-0 text-go-dark" strokeWidth={2.5} /> : <AlertTriangle size={20} className={cx('shrink-0', st.status === 'overdue' ? 'text-stop' : 'text-amber')} strokeWidth={2.5} />}
                      <span className="truncate">{m.name}</span>
                    </h3>
                    <span className={cx('mt-1 inline-block rounded-full border-2 border-ink px-2 py-0.5 text-[11px] font-black uppercase tracking-wide', s.chip)}>{s.label}</span>
                  </div>
                  <button type="button" onClick={() => show(m)} aria-label={`Edit ${m.name}`} className="grid size-12 shrink-0 place-items-center rounded-xl border-2 border-ink active:bg-bg-2">
                    <Pencil size={18} strokeWidth={2.5} />
                  </button>
                </div>
                <div className="num mt-3 text-2xl font-black">
                  {st.remaining > 0 ? (
                    <>
                      {num(st.remaining)} <span className="text-sm text-ink-2">{unit} left</span>
                    </>
                  ) : (
                    <span className="text-stop">
                      {num(-st.remaining)} <span className="text-sm">{unit} overdue</span>
                    </span>
                  )}
                </div>
                <div className="mt-2 h-5 overflow-hidden rounded-full border-2 border-ink bg-bg-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(st.pct)} aria-label={`${m.name} interval used`}>
                  <div className={cx('h-full transition-[width] duration-500', s.bar)} style={{ width: `${Math.max(st.pct, 2)}%` }} />
                </div>
                <div className="num mt-1 flex justify-between text-xs font-bold text-ink-2">
                  <span>Last {num(m.lastServiceOdo)}</span>
                  <span>
                    Every {num(m.interval)} · alert {num(m.notifyBefore)} before
                  </span>
                  <span>Due {num(st.dueAt)}</span>
                </div>
                <Btn
                  tone={st.status === 'ok' ? 'ghost' : 'ink'}
                  className="mt-3 w-full"
                  onClick={() => {
                    justChanged(m.id)
                    toast(`${m.name} reset at ${num(odo)} ${unit}`)
                  }}
                >
                  <RotateCcw size={18} strokeWidth={3} /> Just Changed
                </Btn>
              </Card>
            </li>
          )
        })}
      </ul>

      <Btn tone="amber" big className="w-full" onClick={() => show(null)}>
        <Plus size={22} strokeWidth={3.5} /> Add Service Item
      </Btn>

      <MaintSheet key={form.key} open={open} item={form.item} vehicleId={v.id} odo={odo} onClose={() => setOpen(false)} />
    </div>
  )
}

function MaintSheet({ open, item, vehicleId, odo, onClose }: { open: boolean; item: MaintItem | null; vehicleId: string; odo: number; onClose: () => void }) {
  const unit = useStore((s) => s.settings.unit)
  const { saveMaint, deleteMaint } = useStore.getState()
  const [name, setName] = useState(item?.name ?? '')
  const [interval, setInterval] = useState(String(item?.interval ?? 5000))
  const [notify, setNotify] = useState(String(item?.notifyBefore ?? 500))
  const [last, setLast] = useState(String(item?.lastServiceOdo ?? odo))
  const [err, setErr] = useState<string | null>(null)
  const [del, setDel] = useState(false)

  const save = () => {
    const i = Number(interval)
    const n = Number(notify)
    const l = Number(last)
    if (!name.trim()) return setErr('Give this service item a name.')
    if (!(i > 0)) return setErr('"Change every" must be greater than 0.')
    if (!(n >= 0) || n >= i) return setErr('"Notify before" must be less than the change interval.')
    if (!(l >= 0) || l > odo) return setErr(`Last service reading can't be above the current odometer (${num(odo)}).`)
    saveMaint({ id: item?.id, vehicleId, name: name.trim(), interval: Math.round(i), notifyBefore: Math.round(n), lastServiceOdo: Math.round(l) })
    toast('Service item saved')
    onClose()
  }
  const numInput = (value: string, set: (v: string) => void) => (
    <input className={cx(inputCls, 'num')} inputMode="numeric" value={value} onChange={(e) => (set(e.target.value.replace(/\D/g, '').slice(0, 7)), setErr(null))} />
  )

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={item ? `Edit ${item.name}` : 'Add service item'}
        footer={
          <div className="flex gap-2">
            {item && (
              <Btn tone="danger" aria-label="Delete service item" onClick={() => setDel(true)}>
                <Trash2 size={20} />
              </Btn>
            )}
            <Btn tone="amber" big className="flex-1" onClick={save}>
              <Wrench size={20} strokeWidth={2.5} /> Save
            </Btn>
          </div>
        }
      >
        <Field label="Service item">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cabin filter, Wiper blades" maxLength={28} />
        </Field>
        {!item && (
          <div className="flex flex-wrap gap-2">
            {MAINT_PRESETS.map((p) => (
              <button key={p.name} type="button" onClick={() => (setName(p.name), setInterval(String(p.interval)), setNotify(String(p.notifyBefore)))} className="min-h-12 rounded-xl border-2 border-ink bg-bg-2 px-3 text-sm font-extrabold active:bg-ink active:text-white">
                {p.name}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Change every (${unit})`}>{numInput(interval, setInterval)}</Field>
          <Field label={`Notify before (${unit})`}>{numInput(notify, setNotify)}</Field>
        </div>
        <Field label={`Last service odometer (${unit})`} hint={`Current odometer: ${num(odo)}`}>
          {numInput(last, setLast)}
        </Field>
        <ErrorText>{err}</ErrorText>
      </Sheet>
      <Confirm open={del} onClose={() => setDel(false)} title="Delete service item?" body={`Stop tracking "${item?.name}" for this vehicle.`} action="Delete" onConfirm={() => (item && deleteMaint(item.id), onClose())} />
    </>
  )
}
