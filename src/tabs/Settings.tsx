import { Car, Check, DatabaseBackup, Download, FlaskConical, Pencil, Plus, Smartphone, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Btn, Card, Confirm, cx, ErrorText, Field, inputCls, Segmented, Sheet } from '../components/ui'
import { currentOdo, defaultRate, fmtRate, num } from '../lib/engine'
import { isNative, saveFile } from '../lib/native'
import { snapshot, toast, useStore } from '../lib/store'
import type { Vehicle } from '../lib/types'
import { useInstall } from '../lib/pwa'

export default function Settings() {
  const vehicles = useStore((s) => s.vehicles)
  const activeId = useStore((s) => s.activeVehicleId)
  const shifts = useStore((s) => s.shifts)
  const settings = useStore((s) => s.settings)
  const { selectVehicle, deleteVehicle, setRate, setUnit, setSimBar, simulate, clearAll, restore } = useStore.getState()
  const [form, setForm] = useState<{ v: Vehicle | null; key: number }>({ v: null, key: 0 })
  const [formOpen, setFormOpen] = useState(false)
  const [del, setDel] = useState<Vehicle | null>(null)
  const [confirm, setConfirm] = useState<'clear' | 'demo' | null>(null)
  const [pending, setPending] = useState<unknown>(null)
  const [rateText, setRateText] = useState(fmtRate(settings.rate).slice(1))
  const fileRef = useRef<HTMLInputElement>(null)
  const install = useInstall()
  const { unit } = settings
  const showForm = (v: Vehicle | null) => (setForm((f) => ({ v, key: f.key + 1 })), setFormOpen(true))

  const exportBackup = async () => {
    const saved = await saveFile(`waypoint-backup-${new Date().toLocaleDateString('en-CA')}.json`, JSON.stringify({ app: 'Waypoint', version: 1, exportedAt: new Date().toISOString(), data: snapshot() }, null, 2), 'application/json')
    if (saved) toast(isNative ? 'Backup ready' : 'Backup downloaded')
  }
  const onFile = async (f?: File) => {
    if (!f) return
    try {
      setPending(JSON.parse(await f.text()))
    } catch {
      toast('That file is not valid JSON.', 'err')
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      <Card>
        <h2 className="flex items-center gap-2 border-b-2 border-ink bg-bg-2 px-4 py-3 text-base font-black">
          <Car size={20} strokeWidth={2.5} /> Garage
        </h2>
        <ul className="divide-y-2 divide-slate-200">
          {vehicles.map((v) => {
            const on = v.id === activeId
            return (
              <li key={v.id} className="flex items-center gap-2 p-2">
                <button type="button" onClick={() => selectVehicle(v.id)} aria-pressed={on} aria-label={`Switch to ${v.model}`} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-left active:bg-bg-2">
                  <span className={cx('grid size-8 shrink-0 place-items-center rounded-full border-2 border-ink', on ? 'bg-go-dark text-white' : 'bg-white')}>{on && <Check size={18} strokeWidth={4} />}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-black">{[v.year, v.make, v.model].filter(Boolean).join(' ')}</span>
                    <span className="num block text-xs font-bold text-ink-2">
                      {v.plate || 'No plate'} · {num(currentOdo(v, shifts))} {unit} · started {num(v.startOdo)}
                    </span>
                  </span>
                </button>
                <button type="button" onClick={() => showForm(v)} aria-label={`Edit ${v.model}`} className="grid size-12 shrink-0 place-items-center rounded-xl border-2 border-ink active:bg-bg-2">
                  <Pencil size={18} strokeWidth={2.5} />
                </button>
                <button type="button" onClick={() => setDel(v)} aria-label={`Delete ${v.model}`} className="grid size-12 shrink-0 place-items-center rounded-xl border-2 border-stop text-stop active:bg-red-50">
                  <Trash2 size={18} strokeWidth={2.5} />
                </button>
              </li>
            )
          })}
        </ul>
        <div className="border-t-2 border-ink p-3">
          <Btn tone="amber" className="w-full" onClick={() => showForm(null)}>
            <Plus size={20} strokeWidth={3} /> Add Vehicle
          </Btn>
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card className="space-y-4 p-4">
          <h2 className="text-base font-black">Mileage rate &amp; units</h2>
          <Field label="Distance unit" hint="Odometer readings are kept exactly as entered; switching units converts only the rate.">
            <Segmented
              label="Distance unit"
              value={unit}
              onChange={(u) => {
                setUnit(u)
                setRateText(fmtRate(useStore.getState().settings.rate).slice(1))
              }}
              options={[
                { value: 'mi', label: 'Miles (mi)' } as const,
                { value: 'km', label: 'Kilometers (km)' },
              ]}
            />
          </Field>
          <Field label={`IRS mileage rate ($ per ${unit})`} hint={`Applied to all business ${unit} for the live write-off. Default ${fmtRate(defaultRate(unit))}/${unit}.`}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="num pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-black">$</span>
                <input
                  className={cx(inputCls, 'num pl-8 text-lg')}
                  inputMode="decimal"
                  value={rateText}
                  aria-label={`Rate in dollars per ${unit}`}
                  onChange={(e) => {
                    const t = e.target.value.replace(/[^\d.]/g, '').slice(0, 6)
                    setRateText(t)
                    const n = Number(t)
                    if (t !== '' && Number.isFinite(n) && n >= 0 && n <= 10) setRate(n)
                  }}
                  onBlur={() => setRateText(fmtRate(useStore.getState().settings.rate).slice(1))}
                />
              </div>
              <Btn
                onClick={() => {
                  setRate(defaultRate(unit))
                  setRateText(fmtRate(defaultRate(unit)).slice(1))
                }}
              >
                Reset
              </Btn>
            </div>
          </Field>
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-base font-black">
            <DatabaseBackup size={20} strokeWidth={2.5} /> Backup &amp; restore
          </h2>
          <p className="text-sm font-semibold text-ink-2">Everything is stored on this device only. Export a JSON backup regularly — it includes vehicles, shifts, photos, transactions and alerts.</p>
          <div className="grid grid-cols-2 gap-2">
            <Btn tone="ink" onClick={exportBackup}>
              <Download size={18} strokeWidth={3} /> Export JSON
            </Btn>
            <Btn onClick={() => fileRef.current?.click()}>
              <Upload size={18} strokeWidth={3} /> Restore
            </Btn>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ''))} />
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-base font-black">
            <FlaskConical size={20} strokeWidth={2.5} /> Data &amp; app
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => setConfirm('demo')}>Load sample data</Btn>
            <Btn tone="danger" onClick={() => setConfirm('clear')}>
              <Trash2 size={18} strokeWidth={2.5} /> Clear all data
            </Btn>
          </div>
          <label className="flex min-h-12 items-center justify-between gap-3 text-sm font-extrabold">
            Show preview simulator bar
            <input type="checkbox" className="size-7 accent-[#0F172A]" checked={settings.simBar} onChange={(e) => setSimBar(e.target.checked)} />
          </label>
          {install.state !== 'installed' && (
            <Btn className="w-full" onClick={install.prompt}>
              <Smartphone size={18} strokeWidth={2.5} /> Install Waypoint app
            </Btn>
          )}
        </Card>
      </div>

      <VehicleSheet key={form.key} open={formOpen} vehicle={form.v} onClose={() => setFormOpen(false)} />
      <Confirm
        open={del !== null}
        onClose={() => setDel(null)}
        title={`Delete ${del?.model ?? 'vehicle'}?`}
        body="This permanently removes the vehicle with its entire odometer chain, shift history, transactions and maintenance alerts."
        action="Delete vehicle"
        onConfirm={() => del && (deleteVehicle(del.id), toast('Vehicle deleted'))}
      />
      <Confirm
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'demo' ? 'Load sample data?' : 'Clear all data?'}
        body={confirm === 'demo' ? 'This replaces everything currently in the app with two demo vehicles and several weeks of shifts and transactions. Export a backup first if you have real data.' : 'This erases every vehicle, shift, transaction and alert on this device and returns you to setup. It cannot be undone.'}
        action={confirm === 'demo' ? 'Replace my data' : 'Erase everything'}
        onConfirm={() => (confirm === 'demo' ? (simulate('demo'), toast('Sample data loaded')) : (clearAll(), toast('All data cleared')))}
      />
      <Confirm
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Restore this backup?"
        body="Restoring replaces everything currently in the app with the contents of the backup file."
        action="Restore backup"
        onConfirm={() => {
          const e = restore(pending)
          toast(e ?? 'Backup restored', e ? 'err' : 'ok')
        }}
      />
    </div>
  )
}

export function VehicleSheet({ open, vehicle, onClose }: { open: boolean; vehicle: Vehicle | null; onClose: () => void }) {
  const unit = useStore((s) => s.settings.unit)
  const { addVehicle, updateVehicle } = useStore.getState()
  const [f, setF] = useState({ year: vehicle?.year ?? '', make: vehicle?.make ?? '', model: vehicle?.model ?? '', plate: vehicle?.plate ?? '', startOdo: vehicle ? String(vehicle.startOdo) : '' })
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => (setF({ ...f, [k]: k === 'startOdo' || k === 'year' ? e.target.value.replace(/\D/g, '').slice(0, k === 'year' ? 4 : 7) : e.target.value }), setErr(null))

  const save = () => {
    if (!f.model.trim()) return setErr('Model is required — it’s the name shown in the vehicle switcher.')
    if (f.startOdo === '') return setErr('Enter the starting odometer reading.')
    const data = { year: f.year, make: f.make.trim(), model: f.model.trim(), plate: f.plate.trim().toUpperCase(), startOdo: Number(f.startOdo) }
    const e = vehicle ? updateVehicle(vehicle.id, data) : (addVehicle(data), null)
    setErr(e)
    if (!e) {
      toast(vehicle ? 'Vehicle updated' : `${data.model} added to garage`)
      onClose()
    }
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={vehicle ? 'Edit vehicle' : 'Add vehicle'}
      footer={
        <Btn tone="amber" big className="w-full" onClick={save}>
          Save Vehicle
        </Btn>
      }
    >
      <VehicleFields f={f} set={set} unit={unit} />
      <ErrorText>{err}</ErrorText>
    </Sheet>
  )
}

export function VehicleFields({ f, set, unit }: { f: { year: string; make: string; model: string; plate: string; startOdo: string }; set: (k: 'year' | 'make' | 'model' | 'plate' | 'startOdo') => (e: React.ChangeEvent<HTMLInputElement>) => void; unit: string }) {
  return (
    <>
      <div className="grid grid-cols-[6rem_1fr] gap-3">
        <Field label="Year">
          <input className={cx(inputCls, 'num')} inputMode="numeric" value={f.year} onChange={set('year')} placeholder="2021" />
        </Field>
        <Field label="Make">
          <input className={inputCls} value={f.make} onChange={set('make')} placeholder="Toyota" maxLength={20} autoComplete="off" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Model">
          <input className={inputCls} value={f.model} onChange={set('model')} placeholder="Prius Prime" maxLength={20} autoComplete="off" />
        </Field>
        <Field label="License plate">
          <input className={cx(inputCls, 'num uppercase')} value={f.plate} onChange={set('plate')} placeholder="ABC-1234" maxLength={10} autoComplete="off" />
        </Field>
      </div>
      <Field label={`Starting odometer (${unit})`} hint="The reading on your dash right now. The continuous chain begins here.">
        <input className={cx(inputCls, 'num text-2xl')} inputMode="numeric" value={f.startOdo} onChange={set('startOdo')} placeholder="48210" />
      </Field>
    </>
  )
}
