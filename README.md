# ShiftOdo

A high-contrast, mobile-first PWA for rideshare and delivery drivers: continuous odometer
tracking, IRS mileage write-offs, shifts, maintenance intervals, and income/expenses.
All data stays on the device (localStorage) and the app works offline.

## Run

```bash
npm install
npm run dev      # local dev server
npm test         # engine unit tests (week boundary, odometer chain, breaks, CSV)
npm run build    # type-check + production build with service worker in dist/
npm run preview  # serve the production build
```

## How it works

- **Continuous odometer chain** (`src/lib/engine.ts`): drivers only log a start and end
  odometer per shift. Personal gaps are never stored; they are derived from the distance
  between one shift's end and the next shift's start, so the chain cannot have holes.
  Shift edits are bounded by neighbouring shifts so entries can never overlap.
- **Shift Length** = gross elapsed time − break time. Breaks step in 15-minute increments
  and are clamped to the shift's elapsed time.
- **Payout weeks** start Monday 4:00 AM US Eastern (`America/New_York`, so the boundary
  follows daylight saving). Months are calendar months in the same zone.
- **Units**: switching mi/km converts the rate only; odometer readings stay as entered.
- **State** (`src/lib/store.ts`): one persisted zustand store, scoped per vehicle.

## Layout

```
src/lib/         types, engine (pure logic), store, defaults + demo data, PWA hooks
src/components/  shared UI (sheet, keypad, odometer drum, break stepper), onboarding
src/tabs/        Home, Income, History, Alerts, Settings
```

The tax report is a record-keeping aid, not tax advice.
