import { api } from '../api'
import { useApi } from '../useApi'
import { Card, Kpi, TrendBadge, Loading, ErrorState, StatRow } from '../components'
import { LineTS, AreaTS, BarTS } from '../charts'
import { fmtNum, fmtDur, fmtDate } from '../utils'
import { BANDS, vo2Band, classify, bandTone, hrvStatus, INFO, weeklyBuckets, buildInsights } from '../garmin'

function delta(arr, key) {
  const vals = arr.map((d) => d[key]).filter((v) => v > 0)
  if (vals.length === 0) return { first: 0, last: 0, change: 0, pct: 0 }
  const first = vals[0], last = vals[vals.length - 1]
  const change = last - first
  return { first, last, change, pct: first ? (change / Math.abs(first)) * 100 : 0 }
}
const avg = (arr, key) => {
  const v = arr.map((d) => d[key]).filter((x) => x > 0)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
}

function SectionTitle({ children }) { return <div className="section-title">{children}</div> }

// Horizontal band scale with a marker at the current value.
function BandScale({ value, bands }) {
  const min = bands[0].min, max = bands[bands.length - 1].max
  const pos = value == null ? null : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
  return (
    <div style={{ marginTop: 6 }}>
      {pos != null && (
        <div style={{ position: 'relative', height: 14 }}>
          <div style={{ position: 'absolute', left: `${pos}%`, transform: 'translateX(-50%)', fontSize: 11, color: 'var(--text)' }}>▼</div>
        </div>
      )}
      <div style={{ display: 'flex', height: 9, borderRadius: 6, overflow: 'hidden' }}>
        {bands.map((b) => <div key={b.label} title={b.label} style={{ flex: b.max - b.min, background: b.color, opacity: 0.85 }} />)}
      </div>
      <div style={{ display: 'flex', marginTop: 5 }}>
        {bands.map((b) => <span key={b.label} style={{ flex: b.max - b.min, textAlign: 'center', fontSize: 10, color: 'var(--text-3)' }}>{b.label}</span>)}
      </div>
    </div>
  )
}

function InfoCard({ info, badge, bands, value, extra }) {
  return (
    <Card title={info.title} right={badge}>
      {bands && <BandScale value={value} bands={bands} />}
      {extra}
      <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
        <p><b>What:</b> {info.what}</p>
        <p style={{ marginTop: 6 }}><b>Why it matters:</b> {info.why}</p>
        <p style={{ marginTop: 6 }}><b>How to improve:</b> {info.tip}</p>
      </div>
    </Card>
  )
}

const TONE_ICON = { good: '✅', warn: '⚠️', bad: '🔴', neutral: 'ℹ️' }

export default function GarminTrends() {
  const { data, error, loading } = useApi(
    () =>
      Promise.all([
        api.overview(), api.vo2max(), api.physiology(), api.trainingLoad(),
        api.readiness(), api.sleep(), api.racePredictions(), api.profile(),
      ]).then(([overview, vo2, physio, load, readiness, sleep, races, profile]) =>
        ({ overview, vo2, physio, load, readiness, sleep, races, profile })),
    []
  )

  if (loading) return <Loading label="Crunching your Garmin trends…" />
  if (error) return <ErrorState error={error} />

  const { overview: o, vo2, physio, load, readiness, sleep, races, profile } = data
  const daily = physio.daily || []
  const phys = physio.physio || []
  const rSeries = readiness.series || []
  const loadSeries = load.series || []
  const lastR = rSeries[rSeries.length - 1] || {}
  const lastLoad = loadSeries[loadSeries.length - 1] || {}
  const fitness = physio.fitnessAge || []
  const lastFit = fitness[fitness.length - 1] || {}

  // Athlete age/sex for VO2 category.
  const birth = profile.profile?.birthDate
  const age = birth ? Math.floor((Date.now() - new Date(birth)) / (365.25 * 864e5)) : 25
  const sex = profile.profile?.gender || 'MALE'

  // Period deltas.
  const dVo2 = vo2.trend
  const dHrv = delta(phys, 'hrv')
  const dRhr = delta(daily, 'restingHr')
  const dReady = delta(rSeries, 'score')
  const dSleep = delta(sleep.series || [], 'overallScore')
  const dStress = delta(daily, 'avgStress')
  const bodyBatteryAvg = avg(daily, 'bodyBatteryHigh')
  const lastStress = avg(daily.slice(-3), 'avgStress')

  // Classifications.
  const vo2Bands = vo2Band(age, sex)
  const vo2Cat = classify(dVo2.last, vo2Bands)
  const sleepCat = classify(sleep.avgScore, BANDS.sleep)
  const stressCat = classify(lastStress, BANDS.stress)
  const bbCat = classify(bodyBatteryAvg, BANDS.bodyBattery)
  const acwrCat = classify(lastLoad.ratio, BANDS.acwr)
  const hrvSt = hrvStatus(phys)

  // Insights.
  const insights = buildInsights({
    vo2Change: dVo2.change, rhrChange: dRhr.change, hrvChange: dHrv.change,
    acwrLast: lastLoad.ratio || 0, readinessChange: dReady.change,
    sleepAvg: sleep.avgScore, acuteLast: lastLoad.acute, chronicLast: lastLoad.chronic,
    stressChange: dStress.change, bodyBatteryAvg,
  })

  // Week-over-week: build combined daily records, then bucket.
  const recMap = {}
  const put = (date, key, val) => { if (!date) return; (recMap[date] ||= { date })[key] = val }
  vo2.series.forEach((r) => put(r.date, 'vo2', r.vo2max))
  phys.forEach((r) => put(r.date, 'hrv', r.hrv))
  daily.forEach((r) => { put(r.date, 'rhr', r.restingHr); put(r.date, 'stress', r.avgStress); put(r.date, 'bodyBattery', r.bodyBatteryHigh) })
  rSeries.forEach((r) => put(r.date, 'readiness', r.score))
  ;(sleep.series || []).forEach((r) => put(r.date, 'sleep', r.overallScore))
  const weeks = weeklyBuckets(Object.values(recMap), ['vo2', 'hrv', 'rhr', 'readiness', 'sleep', 'stress', 'bodyBattery'])
  const wk = weeks[weeks.length - 1], pw = weeks[weeks.length - 2]
  const wow = (m, lower = false) => (wk && pw && wk[m] != null && pw[m] != null
    ? <TrendBadge change={wk[m] - pw[m]} pct={pw[m] ? ((wk[m] - pw[m]) / Math.abs(pw[m])) * 100 : 0} lowerIsBetter={lower} /> : <span className="muted">—</span>)

  const wcols = [
    { m: 'vo2', label: 'VO₂', fmt: (v) => fmtNum(v, 1) },
    { m: 'hrv', label: 'HRV', fmt: (v) => fmtNum(v) },
    { m: 'rhr', label: 'RHR', fmt: (v) => fmtNum(v) },
    { m: 'readiness', label: 'Ready', fmt: (v) => fmtNum(v) },
    { m: 'sleep', label: 'Sleep', fmt: (v) => fmtNum(v) },
    { m: 'stress', label: 'Stress', fmt: (v) => fmtNum(v) },
    { m: 'bodyBattery', label: 'Body Batt', fmt: (v) => fmtNum(v) },
  ]

  return (
    <>
      <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
        Every Garmin metric, {o.dateRange?.start} → {o.dateRange?.end}. Classifications are Garmin-style bands; deltas compare first vs latest reading.
      </div>

      {/* Headline KPIs with classification */}
      <div className="grid grid-4">
        <Kpi label="VO₂ Max" value={fmtNum(dVo2.last, 1)} unit="ml/kg/min"
          foot={<><span className={`badge ${bandTone(vo2Cat)}`}>{vo2Cat?.label}</span><TrendBadge change={dVo2.change} pct={dVo2.percentDiff ?? dVo2.pct} /></>} />
        <Kpi label="HRV status" value={fmtNum(o.hrvWeeklyAvg)} unit="ms"
          foot={<><span className={`badge ${hrvSt.tone}`}>{hrvSt.label}</span><TrendBadge change={dHrv.change} pct={dHrv.pct} /></>} />
        <Kpi label="Resting HR" value={fmtNum(dRhr.last)} unit="bpm"
          foot={<TrendBadge change={dRhr.change} pct={dRhr.pct} lowerIsBetter />} />
        <Kpi label="Training readiness" value={fmtNum(lastR.score)} unit="/100"
          foot={<span className="badge neutral">{(lastR.level || '').replace(/_/g, ' ') || '—'}</span>} />
      </div>

      {/* Derived insights */}
      <SectionTitle>Insights — what your data is telling you</SectionTitle>
      <div className="grid grid-2">
        {insights.map((ins, i) => (
          <div key={i} className="card card-pad" style={{ borderLeft: `3px solid ${ins.tone === 'good' ? 'var(--good)' : ins.tone === 'bad' ? 'var(--bad)' : ins.tone === 'warn' ? 'var(--warn)' : 'var(--border-strong)'}` }}>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <span>{TONE_ICON[ins.tone]}</span>
              <strong style={{ fontSize: 14 }}>{ins.title}</strong>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>{ins.text}</div>
          </div>
        ))}
      </div>

      {/* Week over week */}
      <SectionTitle>Week over week</SectionTitle>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Kpi label="VO₂ this wk vs last" value={wk?.vo2 ? fmtNum(wk.vo2, 1) : '—'} foot={wow('vo2')} />
        <Kpi label="HRV this wk vs last" value={wk?.hrv ? fmtNum(wk.hrv) : '—'} foot={wow('hrv')} />
        <Kpi label="Resting HR this wk vs last" value={wk?.rhr ? fmtNum(wk.rhr) : '—'} foot={wow('rhr', true)} />
        <Kpi label="Readiness this wk vs last" value={wk?.readiness ? fmtNum(wk.readiness) : '—'} foot={wow('readiness')} />
      </div>
      <Card pad={false}>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr><th>Week</th>{wcols.map((c) => <th key={c.m} style={{ textAlign: 'right' }}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {weeks.map((w, i) => (
                <tr key={w.key} style={i === weeks.length - 1 ? { background: 'var(--accent-soft)' } : undefined}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{w.label}{i === weeks.length - 1 && <span className="muted" style={{ fontWeight: 400 }}> · latest</span>}</td>
                  {wcols.map((c) => <td key={c.m} className="mono" style={{ textAlign: 'right' }}>{w[c.m] != null ? c.fmt(w[c.m]) : '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Weekly averages (Mon–Sun). Latest week highlighted.</div>

      {/* Aerobic capacity */}
      <SectionTitle>Aerobic capacity</SectionTitle>
      <div className="grid grid-2">
        <Card title="VO₂ Max with 30-day projection" desc="Your aerobic engine — the best single endurance predictor">
          <LineTS data={[...vo2.series.map((s) => ({ date: s.date, vo2: s.vo2max })), ...(vo2.forecast || []).map((f) => ({ date: f.date, projected: f.value }))]}
            valueFmt={(v) => fmtNum(v, 1)} lines={[{ key: 'vo2', name: 'VO₂ max', color: '#2f6fed' }, { key: 'projected', name: 'Projection', color: '#8a93a2', dashed: true }]} />
        </Card>
        <Card title="Race-time predictions" desc="Garmin's modeled finish times">
          <LineTS data={races.series} valueFmt={fmtDur} lines={[{ key: 'time5k', name: '5K', color: '#2f6fed' }, { key: 'time10k', name: '10K', color: '#7a4de0' }, { key: 'timeHalf', name: 'Half', color: '#0e9db6' }]} />
        </Card>
      </div>

      {/* Heart & HRV */}
      <SectionTitle>Heart rate & HRV</SectionTitle>
      <div className="grid grid-2">
        <Card title="Heart-rate variability" desc="Higher, stable HRV = better recovery">
          <AreaTS data={phys.filter((p) => p.hrv > 0)} dataKey="hrv" name="HRV" color="#7a4de0" />
        </Card>
        <Card title="Resting heart rate" desc="A falling resting HR tracks improving fitness">
          <AreaTS data={daily.filter((d) => d.restingHr > 0)} dataKey="restingHr" name="Resting HR" color="#d64550" />
        </Card>
      </div>

      {/* Training load */}
      <SectionTitle>Training load & balance</SectionTitle>
      <div className="grid grid-2">
        <Card title="Acute vs chronic load" desc="Short-term fatigue vs long-term fitness base">
          <LineTS data={loadSeries} lines={[{ key: 'acute', name: 'Acute (7d)', color: '#2f6fed' }, { key: 'chronic', name: 'Chronic (28d)', color: '#8a93a2' }]} />
        </Card>
        <Card title="Acute:Chronic ratio (ACWR)" desc="Sweet spot 0.8–1.3">
          <LineTS data={loadSeries} valueFmt={(v) => fmtNum(v, 2)} lines={[{ key: 'ratio', name: 'ACWR', color: '#7a4de0' }]}
            refLines={[{ y: 1.3, color: '#c98a12', label: '1.3' }, { y: 0.8, color: '#c98a12', label: '0.8' }]} />
        </Card>
      </div>

      {/* Readiness & recovery */}
      <SectionTitle>Readiness & recovery</SectionTitle>
      <div className="grid grid-2">
        <Card title="Training readiness" desc="Composite 0–100 recovery score">
          <AreaTS data={rSeries} dataKey="score" name="Readiness" color="#1a9d6b" yDomain={[0, 100]} />
        </Card>
        <Card title={`What's driving readiness · ${fmtDate(lastR.date)}`} desc="Each factor's contribution on the latest day">
          {[['Sleep', lastR.sleepFactor], ['Sleep history', lastR.sleepHistoryFactor], ['Recovery time', lastR.recoveryFactor], ['HRV', lastR.hrvFactor], ['Acute load', lastR.acwrFactor], ['Stress history', lastR.stressFactor]]
            .map(([k, v]) => <StatRow key={k} k={k} v={`${fmtNum(v)}%`} />)}
        </Card>
      </div>

      {/* Sleep */}
      <SectionTitle>Sleep architecture</SectionTitle>
      <div className="grid grid-2">
        <Card title="Sleep stages" desc="Deep, REM, light and awake minutes per night">
          <BarTS data={sleep.series} bars={[{ key: 'deepMinutes', name: 'Deep', color: '#1f3a8a' }, { key: 'remMinutes', name: 'REM', color: '#2f6fed' }, { key: 'lightMinutes', name: 'Light', color: '#a9c3f5' }, { key: 'awakeMinutes', name: 'Awake', color: '#e6e8ec' }]} />
        </Card>
        <Card title="Sleep score" desc="Nightly overall quality (0–100)">
          <AreaTS data={(sleep.series || []).filter((s) => s.overallScore > 0)} dataKey="overallScore" name="Score" color="#2f6fed" yDomain={[0, 100]} />
        </Card>
      </div>

      {/* Stress & energy */}
      <SectionTitle>Stress, energy & activity</SectionTitle>
      <div className="grid grid-2">
        <Card title="Body battery" desc="Daily peak vs low energy reserves">
          <LineTS data={daily} yDomain={[0, 100]} lines={[{ key: 'bodyBatteryHigh', name: 'Peak', color: '#1a9d6b' }, { key: 'bodyBatteryLow', name: 'Low', color: '#d64550' }]} />
        </Card>
        <Card title="Stress & respiration" desc="Daily average stress and breathing rate">
          <LineTS data={daily} lines={[{ key: 'avgStress', name: 'Stress', color: '#c98a12' }, { key: 'avgRespiration', name: 'Respiration', color: '#0e9db6' }]} />
        </Card>
      </div>

      {/* Reference & meaning */}
      <SectionTitle>Reference & meaning — understand each metric</SectionTitle>
      <div className="grid grid-2">
        <InfoCard info={INFO.vo2} bands={vo2Bands} value={dVo2.last}
          badge={<span className={`badge ${bandTone(vo2Cat)}`}>{vo2Cat?.label}</span>} />
        <InfoCard info={INFO.hrv}
          badge={<span className={`badge ${hrvSt.tone}`}>{hrvSt.label}</span>}
          extra={<div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{hrvSt.detail}</div>} />
        <InfoCard info={INFO.sleep} bands={BANDS.sleep} value={sleep.avgScore}
          badge={<span className={`badge ${bandTone(sleepCat)}`}>{sleepCat?.label}</span>} />
        <InfoCard info={INFO.stress} bands={BANDS.stress} value={lastStress}
          badge={<span className={`badge ${bandTone(stressCat)}`}>{stressCat?.label}</span>} />
        <InfoCard info={INFO.bodyBattery} bands={BANDS.bodyBattery} value={bodyBatteryAvg}
          badge={<span className={`badge ${bandTone(bbCat)}`}>{bbCat?.label}</span>} />
        <InfoCard info={INFO.load} bands={BANDS.acwr} value={lastLoad.ratio}
          badge={<span className={`badge ${bandTone(acwrCat)}`}>{acwrCat?.label}</span>} />
        <InfoCard info={INFO.rhr}
          badge={<span className="badge neutral">{fmtNum(dRhr.last)} bpm</span>}
          extra={<StatRow k="Range in period" v={`${fmtNum(dRhr.first)} → ${fmtNum(dRhr.last)} bpm`} />} />
        <InfoCard info={INFO.readiness}
          badge={<span className="badge neutral">{(lastR.level || '').replace(/_/g, ' ') || '—'}</span>} />
      </div>

      {(sleep.hydration || []).length > 0 && (
        <>
          <SectionTitle>Hydration</SectionTitle>
          <Card title="Fluid intake vs sweat loss" desc="Daily hydration (ml)">
            <BarTS data={sleep.hydration} stacked={false} bars={[{ key: 'intakeMl', name: 'Intake', color: '#0e9db6' }, { key: 'sweatLossMl', name: 'Sweat loss', color: '#d64550' }]} />
          </Card>
        </>
      )}

      <div className="muted" style={{ fontSize: 12, margin: '24px 2px 0' }}>
        Classifications approximate Garmin/Firstbeat bands. Upload a fresh export monthly on <b>Garmin Connect</b> to extend every trend.
      </div>
    </>
  )
}
