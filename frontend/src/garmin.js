// Classification bands, plain-English explanations, weekly grouping and a
// rule-based insight engine for the Garmin Trends page.

const C = { red: '#d64550', amber: '#c98a12', green: '#1a9d6b', blue: '#2f6fed', purple: '#7a4de0' }

// ---------- classification bands ----------

// VO2 max fitness category by age & sex (Firstbeat-style, approximate).
function vo2Bands(age = 25, sex = 'MALE') {
  const table = [
    { maxAge: 29, cuts: [42, 46, 52, 56] },
    { maxAge: 39, cuts: [41, 45, 50, 54] },
    { maxAge: 49, cuts: [39, 43, 48, 52] },
    { maxAge: 59, cuts: [37, 41, 46, 50] },
    { maxAge: 200, cuts: [33, 37, 42, 46] },
  ]
  const row = table.find((r) => age <= r.maxAge) || table[table.length - 1]
  const off = sex === 'FEMALE' ? -7 : 0
  const [fair, good, exc, sup] = row.cuts.map((c) => c + off)
  return [
    { label: 'Poor', min: Math.max(20, fair - 12), max: fair, color: C.red },
    { label: 'Fair', min: fair, max: good, color: C.amber },
    { label: 'Good', min: good, max: exc, color: C.green },
    { label: 'Excellent', min: exc, max: sup, color: C.blue },
    { label: 'Superior', min: sup, max: sup + 10, color: C.purple },
  ]
}

export const BANDS = {
  sleep: [
    { label: 'Poor', min: 0, max: 60, color: C.red },
    { label: 'Fair', min: 60, max: 80, color: C.amber },
    { label: 'Good', min: 80, max: 90, color: C.green },
    { label: 'Excellent', min: 90, max: 100, color: C.blue },
  ],
  stress: [
    { label: 'Resting', min: 0, max: 26, color: C.green },
    { label: 'Low', min: 26, max: 51, color: C.blue },
    { label: 'Medium', min: 51, max: 76, color: C.amber },
    { label: 'High', min: 76, max: 100, color: C.red },
  ],
  bodyBattery: [
    { label: 'Low', min: 0, max: 26, color: C.red },
    { label: 'Medium', min: 26, max: 51, color: C.amber },
    { label: 'High', min: 51, max: 76, color: C.green },
    { label: 'Very High', min: 76, max: 100, color: C.blue },
  ],
  acwr: [
    { label: 'Detraining', min: 0, max: 0.8, color: C.amber },
    { label: 'Optimal', min: 0.8, max: 1.3, color: C.green },
    { label: 'Caution', min: 1.3, max: 1.5, color: C.amber },
    { label: 'High risk', min: 1.5, max: 2.5, color: C.red },
  ],
}

export function vo2Band(age, sex) { return vo2Bands(age, sex) }

// classify returns the band a value falls into.
export function classify(value, bands) {
  if (value == null) return null
  return bands.find((b) => value >= b.min && value < b.max) || bands[bands.length - 1]
}

// tone maps a band color to a Garmin-ramp badge class.
export function bandTone(band) {
  if (!band) return 'neutral'
  return { [C.red]: 'poor', [C.amber]: 'fair', [C.green]: 'good', [C.blue]: 'excellent', [C.purple]: 'superior' }[band.color] || 'neutral'
}

// HRV status derived from the athlete's own baseline (mean ± spread).
export function hrvStatus(series) {
  const vals = series.map((p) => p.hrv).filter((v) => v > 0)
  if (vals.length < 4) return { label: 'Onboarding', tone: 'neutral', detail: 'Not enough data yet to establish your baseline.' }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1
  const last = vals[vals.length - 1]
  if (last < mean - 0.75 * sd) return { label: 'Unbalanced (low)', tone: 'bad', detail: 'Recent HRV is below your usual range — often a sign of fatigue, stress or illness.' }
  if (last > mean + 1.2 * sd) return { label: 'Unbalanced (high)', tone: 'warn', detail: 'Recent HRV is unusually high vs your baseline — sometimes follows heavy load or poor sleep.' }
  return { label: 'Balanced', tone: 'good', detail: 'Your HRV sits within your normal personal range — a healthy, well-recovered signal.' }
}

// ---------- explanations ----------

export const INFO = {
  vo2: {
    title: 'VO₂ Max',
    what: 'The maximum oxygen your body can use per minute, per kg of body weight — your aerobic engine size.',
    why: 'It’s the strongest single predictor of endurance performance. Higher = you can hold faster paces for longer.',
    tip: 'Raise it with a mix of long easy runs (Zone 2) and short hard intervals (VO₂ work, 3–5 min efforts).',
  },
  hrv: {
    title: 'Heart-Rate Variability (HRV)',
    what: 'The tiny beat-to-beat timing differences in your heart rate, measured overnight in milliseconds.',
    why: 'Higher, stable HRV reflects a well-recovered nervous system. A drop below your baseline flags fatigue, stress or illness.',
    tip: 'It’s personal — compare against your own baseline, not others. Protect it with sleep and easy days.',
  },
  rhr: {
    title: 'Resting Heart Rate',
    what: 'Your lowest heart rate, typically measured while sleeping.',
    why: 'As aerobic fitness improves, resting HR usually falls. A sudden rise can mean under-recovery or illness.',
    tip: 'Track the trend, not single days. A creeping increase over a week is worth easing off for.',
  },
  readiness: {
    title: 'Training Readiness',
    what: 'A 0–100 score blending sleep, recovery time, HRV, stress and training load.',
    why: 'It tells you how primed you are to absorb hard training today.',
    tip: 'High/Prime days are for key sessions; Low/Poor days are for easy work or rest.',
  },
  load: {
    title: 'Acute vs Chronic Load & ACWR',
    what: 'Acute = last 7 days of training strain; Chronic = your 28-day fitness base. ACWR is their ratio.',
    why: 'Ramping acute far above chronic (ACWR > 1.5) is the classic injury-risk spike; sitting below 0.8 means detraining.',
    tip: 'Keep ACWR in the 0.8–1.3 “sweet spot” — build load gradually, ~10% per week.',
  },
  sleep: {
    title: 'Sleep Score & Stages',
    what: 'An overall 0–100 quality score plus time in deep, REM and light sleep.',
    why: 'Deep sleep drives physical repair; REM supports the brain and adaptation. Both are when you actually get fitter.',
    tip: 'Consistent bed/wake times and 7–9 h total do more for the score than any single night.',
  },
  stress: {
    title: 'Stress',
    what: 'A 0–100 estimate from HRV of how much your body is in a “fight-or-flight” vs recovery state during the day.',
    why: 'Chronically high daytime stress blunts recovery and adaptation even if you train well.',
    tip: 'Build in low-stress recovery windows; breathing, walks and easy days pull it down.',
  },
  bodyBattery: {
    title: 'Body Battery',
    what: 'A 0–100 estimate of your energy reserves, charged by rest/sleep and drained by activity and stress.',
    why: 'It shows whether you’re starting the day topped up or already depleted.',
    tip: 'Aim to start key sessions with a high battery; a peak that never recovers signals accumulated fatigue.',
  },
  endurance: {
    title: 'Endurance Score',
    what: 'A Garmin measure of your capacity to sustain prolonged effort, built from load history across intensities.',
    why: 'It reflects the durability that matters for long races (half/marathon, long rides, open-water swims).',
    tip: 'Grows from consistent volume and long efforts over weeks — not any single workout.',
  },
}

// ---------- weekly grouping ----------

function weekStart(iso) {
  const d = new Date(iso + 'T00:00:00')
  const dow = (d.getDay() + 6) % 7 // Monday = 0
  d.setDate(d.getDate() - dow)
  return d
}
const fmtShort = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// weeklyBuckets averages each metric per ISO week from combined daily records.
export function weeklyBuckets(records, metrics) {
  const groups = new Map()
  for (const rec of records) {
    if (!rec.date) continue
    const ws = weekStart(rec.date)
    const key = ws.toISOString().slice(0, 10)
    if (!groups.has(key)) groups.set(key, { start: ws, rows: [] })
    groups.get(key).rows.push(rec)
  }
  const out = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, g]) => {
    const end = new Date(g.start); end.setDate(end.getDate() + 6)
    const week = { key, label: `${fmtShort(g.start)}–${fmtShort(end)}` }
    for (const m of metrics) {
      const vals = g.rows.map((r) => r[m]).filter((v) => v != null && v > 0)
      week[m] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    return week
  })
  return out
}

// ---------- insight engine ----------

export function buildInsights(ctx) {
  const out = []
  const add = (tone, title, text) => out.push({ tone, title, text })
  const { vo2Change, rhrChange, hrvChange, acwrLast, readinessChange, sleepAvg, acuteLast, chronicLast, stressChange, bodyBatteryAvg } = ctx

  if (vo2Change > 0.3 && rhrChange < -0.5)
    add('good', 'Aerobic base is improving', 'VO₂ Max is rising while your resting heart rate falls — a textbook sign your aerobic fitness is genuinely improving.')
  else if (vo2Change < -0.3 && rhrChange > 0.5)
    add('bad', 'Possible fatigue or detraining', 'VO₂ Max is drifting down while resting HR climbs. This pairing often means accumulated fatigue, illness, or a training gap — prioritise recovery.')

  if (acwrLast > 1.5)
    add('bad', 'Training-load spike', `Your acute:chronic ratio is ${acwrLast.toFixed(2)} — above 1.5. You’ve ramped load faster than your base can absorb, raising injury risk. Ease back this week.`)
  else if (acwrLast >= 0.8 && acwrLast <= 1.3)
    add('good', 'Load is well balanced', `ACWR ${acwrLast.toFixed(2)} sits in the optimal 0.8–1.3 band — you’re building fitness without overreaching.`)
  else if (acwrLast > 0 && acwrLast < 0.8)
    add('warn', 'Load is tapering / low', `ACWR ${acwrLast.toFixed(2)} is below 0.8 — fine for a taper or rest week, but sustained low load slowly erodes fitness.`)

  if (hrvChange < -3)
    add('warn', 'HRV trending down', 'Your HRV has fallen over the period, which usually reflects rising stress or fatigue. Bank some easy days and sleep.')
  else if (hrvChange > 3)
    add('good', 'HRV trending up', 'Rising HRV suggests your recovery and autonomic balance are improving — you’re adapting well to training.')

  if (sleepAvg && sleepAvg < 60)
    add('warn', 'Sleep is limiting recovery', `Your average sleep score is ${Math.round(sleepAvg)} (“Poor–Fair”). Sleep is where adaptation happens — improving it is likely your biggest easy win.`)
  else if (sleepAvg && sleepAvg >= 80)
    add('good', 'Strong sleep quality', `An average sleep score of ${Math.round(sleepAvg)} means recovery is well supported.`)

  if (readinessChange < -8)
    add('warn', 'Readiness is declining', 'Your training-readiness trend is dropping — recovery debt may be building. Consider a lighter few days before the next hard block.')

  if (acuteLast && chronicLast && acuteLast > chronicLast * 1.3)
    add('warn', 'You’re ramping hard', 'Recent (acute) load is well above your fitness base (chronic). Fine short-term for a build, but don’t sustain it for long.')

  if (stressChange > 8)
    add('warn', 'Daytime stress is rising', 'Average stress has increased over the period. High off-training stress competes with recovery — protect low-stress windows.')

  if (bodyBatteryAvg && bodyBatteryAvg < 40)
    add('warn', 'Energy reserves run low', `Your body battery peaks around ${Math.round(bodyBatteryAvg)} on average — you’re often starting days under-charged. More rest/sleep will lift it.`)

  if (out.length === 0)
    add('neutral', 'Holding steady', 'Your key metrics are stable over this period — no strong upward or downward trends to flag right now.')

  return out
}
