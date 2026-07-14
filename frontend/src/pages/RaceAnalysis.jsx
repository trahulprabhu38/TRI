import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useApi } from '../useApi'
import { Card, Loading, ErrorState, Empty, TrendBadge, StatRow } from '../components'
import { LineTS, CompareBars, RadarTS } from '../charts'
import { fmtDur, fmtSportPace, fmtNum, SPORT_META, fmtDate, signed, decodePolyline } from '../utils'
import RouteMap from '../RouteMap'

// Distinct colours per race in the comparison (Garmin-ish ramp).
const RACE_COLORS = ['#2f6fed', '#7a4de0', '#0e9db6', '#c98a12']

const SPORTS = ['running', 'cycling', 'swimming']
const SPORT_WORDS = { swim: 'swimming', run: 'running', cycl: 'cycling', bike: 'cycling', ride: 'cycling' }

export default function RaceAnalysis() {
  const { data, error, loading } = useApi(() => api.races(), [])
  const [sport, setSport] = useState('running')
  const [query, setQuery] = useState('')
  const [slots, setSlots] = useState(['', ''])
  const [analysis, setAnalysis] = useState(null)
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState(null)

  const races = data?.races || []
  const sportRaces = useMemo(
    () => races.filter((r) => r.sport === sport).sort((a, b) => b.date.localeCompare(a.date)),
    [races, sport]
  )

  useEffect(() => {
    if (sportRaces.length >= 2) {
      setSlots((prev) => (prev.every((s) => !s) ? [sportRaces[0].id, sportRaces[1].id] : prev))
    }
  }, [sportRaces])

  if (loading) return <Loading />
  if (error) return <ErrorState error={error} />

  // No real data yet — guide the user to sync instead of showing anything fake.
  if (races.length === 0) {
    return (
      <Card title="No races yet" desc="Race Analysis shows your real synced activities only">
        <Empty>
          <div style={{ textAlign: 'center', maxWidth: 380 }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>🏁</div>
            <p className="muted" style={{ marginBottom: 16 }}>
              Connect Strava and sync to pull your runs, rides and swims. Nothing is shown here until real data arrives.
            </p>
            <Link to="/connect" className="btn accent">Connect Strava</Link>
          </div>
        </Empty>
      </Card>
    )
  }

  const q = query.trim().toLowerCase()
  const sportWordHit = Object.keys(SPORT_WORDS).some((k) => q.includes(k))
  const displayed = sportRaces.filter((r) => !q || sportWordHit || r.name.toLowerCase().includes(q))
  const chosen = slots.filter(Boolean)
  const uniqueChosen = [...new Set(chosen)]
  const canCompare = uniqueChosen.length >= 2

  function switchSport(s) {
    setSport(s); setAnalysis(null); setSlots(['', ''])
  }
  function onSearch(v) {
    setQuery(v)
    const l = v.toLowerCase()
    for (const k in SPORT_WORDS) {
      if (l.includes(k) && SPORT_WORDS[k] !== sport) { switchSport(SPORT_WORDS[k]); return }
    }
  }
  const setSlot = (i, id) => setSlots((s) => s.map((v, idx) => (idx === i ? id : v)))
  const addSlot = () => setSlots((s) => (s.length < 4 ? [...s, ''] : s))
  const removeSlot = (i) => setSlots((s) => (s.length > 2 ? s.filter((_, idx) => idx !== i) : s))

  async function compare() {
    if (!canCompare) return
    setBusy(true)
    try { setAnalysis({ ...(await api.analyzeRaces(uniqueChosen)), sport }) }
    finally { setBusy(false) }
  }

  const raceLabel = (r) =>
    `${fmtDate(r.date)} · ${r.name} · ${fmtNum(r.distanceKm, r.distanceKm < 2 ? 2 : 1)}km`

  return (
    <>
      {/* Search + sport toggle */}
      <div className="spread" style={{ marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div className="pill-list">
          {SPORTS.map((s) => {
            const meta = SPORT_META[s]
            const n = races.filter((r) => r.sport === s).length
            return (
              <button key={s}
                className={`badge ${sport === s ? 'accent' : 'neutral'}`}
                style={{ cursor: 'pointer', padding: '9px 16px', fontSize: 13.5 }}
                onClick={() => { switchSport(s); setQuery('') }}>
                {meta.icon} {meta.label} <span style={{ opacity: 0.6, marginLeft: 4 }}>{n}</span>
              </button>
            )
          })}
        </div>
        <div style={{ position: 'relative', minWidth: 260, flex: '0 1 320px' }}>
          <span style={{ position: 'absolute', left: 12, top: 9, color: 'var(--text-3)' }}>🔍</span>
          <input className="input" style={{ paddingLeft: 34 }}
            placeholder='Search "swimmer", "running", or a race name…'
            value={query} onChange={(e) => onSearch(e.target.value)} />
        </div>
      </div>

      {/* Race list — date + full name, click for details */}
      <Card title={`Your ${SPORT_META[sport].label.toLowerCase()} races`} desc="Click any race to see the full breakdown" pad={false}>
        {displayed.length === 0 ? (
          <Empty><span className="muted">No {SPORT_META[sport].label.toLowerCase()} races match your search.</span></Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th>Race</th><th>Distance</th><th>Time</th><th>Pace</th><th>Avg HR</th></tr>
            </thead>
            <tbody>
              {displayed.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setDetail(r)}>
                  <td className="mono">{fmtDate(r.date)}</td>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td className="mono">{fmtNum(r.distanceKm, r.distanceKm < 2 ? 2 : 1)} km</td>
                  <td className="mono">{fmtDur(r.durationSec)}</td>
                  <td className="mono">{fmtSportPace(r.avgPaceSecKm, r.sport)}</td>
                  <td className="mono">{r.avgHr ? `${fmtNum(r.avgHr)} bpm` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Compare 2–4 */}
      <div style={{ marginTop: 16 }}>
        <Card title={`Compare ${SPORT_META[sport].label.toLowerCase()} races`} desc="Pick 2 to 4 races, then Compare">
          {displayed.length < 2 ? (
            <Empty><span className="muted">Need at least two races in this sport to compare.</span></Empty>
          ) : (
            <>
              <div className="grid" style={{ gap: 10 }}>
                {slots.map((val, i) => (
                  <div key={i} className="row" style={{ gap: 8 }}>
                    <span className="badge neutral" style={{ minWidth: 26, justifyContent: 'center' }}>{i + 1}</span>
                    <select className="select" value={val} onChange={(e) => setSlot(i, e.target.value)} style={{ flex: 1 }}>
                      <option value="">— select a race —</option>
                      {displayed.map((r) => (
                        <option key={r.id} value={r.id} disabled={slots.includes(r.id) && r.id !== val}>
                          {raceLabel(r)}
                        </option>
                      ))}
                    </select>
                    {slots.length > 2 && (
                      <button className="btn ghost" style={{ padding: '8px 11px' }} onClick={() => removeSlot(i)}>✕</button>
                    )}
                  </div>
                ))}
              </div>
              <div className="spread" style={{ marginTop: 14 }}>
                <button className="btn ghost" disabled={slots.length >= 4} onClick={addSlot}>
                  + Add race {slots.length >= 4 && '(max 4)'}
                </button>
                <button className="btn accent" disabled={!canCompare || busy} onClick={compare}>
                  {busy ? 'Comparing…' : `Compare ${uniqueChosen.length || ''}`}
                </button>
              </div>
              {!canCompare && <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Choose at least two different races.</div>}
            </>
          )}
        </Card>
      </div>

      {analysis && <AnalysisView a={analysis} sport={analysis.sport} />}
      {detail && <RaceDetailModal race={detail} onClose={() => setDetail(null)} />}
    </>
  )
}

function RaceDetailModal({ race, onClose }) {
  const sport = race.sport
  const meta = SPORT_META[sport] || { icon: '•', label: sport }
  const stravaId = race.id?.startsWith('strava-') ? race.id.slice(7) : null

  const rows = [
    ['Distance', `${fmtNum(race.distanceKm, race.distanceKm < 2 ? 2 : 1)} km`],
    ['Finish time', fmtDur(race.durationSec)],
    ['Pace', fmtSportPace(race.avgPaceSecKm, sport)],
    ['Avg heart rate', race.avgHr ? `${fmtNum(race.avgHr)} bpm` : '—'],
    ['Max heart rate', race.maxHr ? `${fmtNum(race.maxHr)} bpm` : '—'],
    [sport === 'swimming' ? 'Stroke rate' : 'Cadence', race.avgCadence ? fmtNum(race.avgCadence) : '—'],
    ['Avg power', race.avgPowerW ? `${fmtNum(race.avgPowerW)} W` : '—'],
    ['Calories', race.calories ? fmtNum(race.calories) : '—'],
    ['Elevation gain', race.elevationGain ? `${fmtNum(race.elevationGain)} m` : '—'],
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <span className="badge neutral">{meta.icon} {meta.label}</span>
              <span className="muted mono" style={{ fontSize: 12 }}>{fmtDate(race.date)} · {race.date}</span>
            </div>
            <h2 style={{ fontSize: 18 }}>{race.name}</h2>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            {rows.map(([k, v]) => <StatRow key={k} k={k} v={v} />)}
          </div>
          {stravaId && (
            <a className="btn ghost" style={{ marginTop: 18 }} href={`https://www.strava.com/activities/${stravaId}`} target="_blank" rel="noreferrer">
              View on Strava ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function metricsFor(sport) {
  return [
    { key: 'durationSec', label: 'Finish time', dir: 'low', fmt: (v) => fmtDur(v) },
    { key: 'avgPaceSecKm', label: 'Pace', dir: 'low', fmt: (v) => fmtSportPace(v, sport) },
    { key: 'avgHr', label: 'Avg heart rate', dir: 'low', fmt: (v) => (v ? `${fmtNum(v)} bpm` : '—') },
    { key: 'maxHr', label: 'Max heart rate', dir: null, fmt: (v) => (v ? `${fmtNum(v)} bpm` : '—') },
    { key: 'avgCadence', label: sport === 'swimming' ? 'Stroke rate' : 'Cadence', dir: sport === 'cycling' ? null : 'high', fmt: (v) => (v ? fmtNum(v) : '—') },
    { key: 'avgPowerW', label: 'Avg power', dir: 'high', fmt: (v) => (v ? `${fmtNum(v)} W` : '—') },
    { key: 'calories', label: 'Calories', dir: null, fmt: (v) => (v ? fmtNum(v) : '—') },
    { key: 'elevationGain', label: 'Elevation gain', dir: null, fmt: (v) => (v ? `${fmtNum(v)} m` : '—') },
  ]
}

function AnalysisView({ a }) {
  const sport = a.sport
  if (!a.enough) return <Card title="Comparison"><Empty><span className="muted">Select at least two races.</span></Empty></Card>

  const races = a.races
  const chartData = races.map((r) => ({ date: r.date, pace: r.avgPaceSecKm, time: r.durationSec }))
  const paceFmt = (v) => fmtSportPace(v, sport)
  const metrics = metricsFor(sport).filter((m) => races.some((r) => r[m.key] > 0))
  const base = races[0]
  const color = (i) => RACE_COLORS[i % RACE_COLORS.length]
  const shortName = (r, i) => `${i + 1}. ${r.name.length > 14 ? r.name.slice(0, 13) + '…' : r.name}`

  function cellClass(m, value, isFirst) {
    if (isFirst || !m.dir || !value || !base[m.key]) return ''
    const better = m.dir === 'low' ? value < base[m.key] : value > base[m.key]
    const worse = m.dir === 'low' ? value > base[m.key] : value < base[m.key]
    return better ? 'good' : worse ? 'bad' : ''
  }

  // Per-metric bar sets (only metrics with data).
  const barMetrics = metrics.filter((m) => m.key !== 'avgPaceSecKm')
  const decoded = races.map((r) => (r.polyline ? decodePolyline(r.polyline) : []))

  // Radar: normalise each metric to % of the max among selected races.
  const radarKeys = [
    { key: 'distanceKm', label: 'Distance' },
    { key: 'durationSec', label: 'Duration' },
    { key: 'avgHr', label: 'Avg HR' },
    { key: 'avgCadence', label: sport === 'swimming' ? 'Stroke rate' : 'Cadence' },
    { key: 'avgPowerW', label: 'Power' },
    { key: 'elevationGain', label: 'Elevation' },
    { key: 'calories', label: 'Calories' },
  ].filter((rk) => races.some((r) => r[rk.key] > 0))
  const raceLabels = races.map((r, i) => shortName(r, i))
  const radarData = radarKeys.map((rk) => {
    const max = Math.max(...races.map((r) => r[rk.key] || 0)) || 1
    const row = { metric: rk.label }
    races.forEach((r, i) => { row[raceLabels[i]] = Math.round(((r[rk.key] || 0) / max) * 100) })
    return row
  })
  const radarSeries = races.map((r, i) => ({ key: raceLabels[i], name: raceLabels[i], color: color(i) }))

  return (
    <>
      <div className="section-title">Comparison · {races.length} {SPORT_META[sport].label.toLowerCase()} races</div>

      {/* Maps side by side */}
      <div className="grid" style={{ gridTemplateColumns: `repeat(${races.length}, 1fr)`, gap: 16, marginBottom: 20 }}>
        {races.map((r, i) => (
          <div key={r.id} className="card" style={{ overflow: 'hidden', borderTop: `3px solid ${color(i)}` }}>
            {decoded[i].length > 1
              ? <RouteMap points={decoded[i]} color={color(i)} height={170} />
              : <div style={{ height: 170, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', color: 'var(--text-3)', fontSize: 12 }}>No GPS route</div>}
            <div className="card-pad" style={{ paddingTop: 12 }}>
              <div className="spread">
                <span className="badge neutral" style={{ color: color(i) }}>{i + 1}</span>
                <span className="muted mono" style={{ fontSize: 12 }}>{fmtDate(r.date)}</span>
              </div>
              <div style={{ fontWeight: 600, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
              <div className="mono" style={{ fontSize: 18, marginTop: 4 }}>{fmtDur(r.durationSec)}</div>
              <div className="muted mono" style={{ fontSize: 12 }}>{fmtNum(r.distanceKm, r.distanceKm < 2 ? 2 : 1)} km · {paceFmt(r.avgPaceSecKm)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Card title="Fastest race">
          <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>{a.best.name}</div>
          <div className="mono" style={{ fontSize: 20, marginTop: 4 }}>{fmtDur(a.best.durationSec)}</div>
          <div className="muted" style={{ fontSize: 12 }}>{paceFmt(a.best.avgPaceSecKm)}</div>
        </Card>
        <Card title="Pace trend">
          <div style={{ marginTop: 6 }}><TrendBadge change={a.paceTrend.change} pct={a.paceTrend.percentDiff} lowerIsBetter suffix="s/km" /></div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{a.improved ? 'Getting faster over time' : 'Slowing over time'}</div>
        </Card>
        <Card title="Average pace">
          <div className="mono" style={{ fontSize: 20, marginTop: 6 }}>{paceFmt(a.avgPace)}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>avg HR {fmtNum(a.avgHr)} bpm</div>
        </Card>
        <Card title="Next-race projection">
          <div className="mono" style={{ fontSize: 20, marginTop: 6 }}>{fmtDur(a.projectedTime)}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>at {fmtNum(a.projectDist, a.projectDist < 2 ? 2 : 1)} km · {paceFmt(a.projectedPace)}</div>
        </Card>
      </div>

      <div className="section-title">Stat-by-stat comparison</div>
      <Card pad={false}>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}>Metric</th>
                {races.map((r, i) => (
                  <th key={r.id} style={{ textAlign: 'right' }}>
                    {r.name}<br /><span style={{ fontWeight: 400, textTransform: 'none' }} className="muted">{fmtDate(r.date)}{i === 0 ? ' · base' : ''}</span>
                  </th>
                ))}
                <th style={{ textAlign: 'right' }}>Change</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => {
                const first = base[m.key]
                const last = races[races.length - 1][m.key]
                const change = last - first
                return (
                  <tr key={m.key}>
                    <td style={{ fontWeight: 600, position: 'sticky', left: 0, background: 'var(--surface)' }}>{m.label}</td>
                    {races.map((r, i) => {
                      const cls = cellClass(m, r[m.key], i === 0)
                      return (
                        <td key={r.id} className="mono" style={{ textAlign: 'right' }}>
                          <span className={cls ? `badge ${cls}` : ''}>{m.fmt(r[m.key])}</span>
                        </td>
                      )
                    })}
                    <td style={{ textAlign: 'right' }}>
                      {m.dir && first > 0 && last > 0 && change !== 0
                        ? <TrendBadge change={change} lowerIsBetter={m.dir === 'low'} suffix={m.key === 'durationSec' ? 's' : ''} />
                        : <span className="muted mono">{change !== 0 && first ? signed(change, 0) : '—'}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="muted" style={{ fontSize: 12, margin: '10px 2px 0' }}>
        Green = improved vs your first selected race · red = regressed. The Change column compares first → last.
      </div>

      {/* Multi-metric radar */}
      {radarKeys.length >= 3 && (
        <>
          <div className="section-title">Multi-metric overview</div>
          <Card title="Race profiles" desc="Each metric scaled to the highest value among the selected races (100% = the biggest)">
            <RadarTS data={radarData} series={radarSeries} />
          </Card>
        </>
      )}

      {/* Per-metric bar charts */}
      <div className="section-title">Metric-by-metric</div>
      <div className="grid grid-3">
        {barMetrics.map((m) => {
          const items = races.map((r, i) => ({ name: `${i + 1}`, value: r[m.key] || 0 }))
          if (items.every((it) => it.value === 0)) return null
          return (
            <Card key={m.key} title={m.label}>
              <CompareBars data={items} colors={races.map((_, i) => color(i))} valueFmt={m.fmt} />
            </Card>
          )
        })}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Bars are numbered per race: {races.map((r, i) => `${i + 1} = ${r.name}`).join(' · ')}
      </div>

      {/* Trends over time */}
      <div className="section-title">Over time</div>
      <div className="grid grid-2">
        <Card title="Pace across races" desc="Lower is faster">
          <LineTS data={chartData} valueFmt={paceFmt} lines={[{ key: 'pace', name: 'Pace', color: SPORT_META[sport].color }]} />
        </Card>
        <Card title="Finish times" desc="Absolute durations">
          <LineTS data={chartData} valueFmt={fmtDur} lines={[{ key: 'time', name: 'Finish time', color: '#7a4de0' }]} />
        </Card>
      </div>
    </>
  )
}

