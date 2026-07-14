import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Cell,
} from 'recharts'
import { fmtDate } from './utils'

const AXIS = { fontSize: 11, fill: '#8a93a2' }
const GRID = '#eef0f3'

function Box({ children }) {
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>{children}</ResponsiveContainer>
    </div>
  )
}

function tip(fmt) {
  return ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null
    return (
      <div style={{
        background: '#fff', border: '1px solid var(--border-strong)', borderRadius: 8,
        padding: '8px 11px', boxShadow: 'var(--shadow-lg)', fontSize: 12,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{fmtDate(label)}</div>
        {payload.map((p) => (
          <div key={p.dataKey} style={{ color: p.color, display: 'flex', justifyContent: 'space-between', gap: 14 }}>
            <span>{p.name}</span>
            <span style={{ fontWeight: 600 }}>{fmt ? fmt(p.value) : p.value}</span>
          </div>
        ))}
      </div>
    )
  }
}

// Single or multi-line time series.
export function LineTS({ data, lines, xKey = 'date', valueFmt, yDomain, refLines = [] }) {
  return (
    <Box>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} tickFormatter={fmtDate} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={28} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={yDomain || ['auto', 'auto']} width={44} />
        <Tooltip content={tip(valueFmt)} />
        {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />}
        {refLines.map((r, i) => (
          <ReferenceLine key={i} y={r.y} stroke={r.color || '#d3d7de'} strokeDasharray="4 4"
            label={{ value: r.label, position: 'right', fontSize: 10, fill: r.color || '#8a93a2' }} />
        ))}
        {lines.map((l) => (
          <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color}
            strokeWidth={2} dot={false} strokeDasharray={l.dashed ? '5 4' : undefined}
            connectNulls activeDot={{ r: 4 }} />
        ))}
      </LineChart>
    </Box>
  )
}

// Area chart for a single accented series.
export function AreaTS({ data, dataKey, name, color = '#2f6fed', xKey = 'date', valueFmt, yDomain }) {
  const id = `grad-${dataKey}`
  return (
    <Box>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} tickFormatter={fmtDate} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={28} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={yDomain || ['auto', 'auto']} width={44} />
        <Tooltip content={tip(valueFmt)} />
        <Area type="monotone" dataKey={dataKey} name={name} stroke={color} strokeWidth={2}
          fill={`url(#${id})`} dot={false} connectNulls activeDot={{ r: 4 }} />
      </AreaChart>
    </Box>
  )
}

// Stacked bars (e.g. sleep stages) or grouped bars.
export function BarTS({ data, bars, xKey = 'date', valueFmt, stacked = true, height = 260 }) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS} tickFormatter={fmtDate} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={20} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={tip(valueFmt)} />
          {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {bars.map((b) => (
            <Bar key={b.key} dataKey={b.key} name={b.name} stackId={stacked ? 's' : undefined}
              fill={b.color} radius={stacked ? 0 : [3, 3, 0, 0]} maxBarSize={26} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// Categorical bar chart (x = label, single value) for per-metric race comparison.
export function CompareBars({ data, colors, valueFmt, height = 180 }) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />
          <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }}
            formatter={(v) => [valueFmt ? valueFmt(v) : v, 'value']} labelFormatter={(l) => l} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={64}>
            {data.map((d, i) => <Cell key={i} fill={(colors && colors[i]) || '#2f6fed'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// Radar chart comparing several races across normalized (0–100%) metrics.
export function RadarTS({ data, series, height = 320 }) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke={GRID} />
          <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: '#5b6472' }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          {series.map((s) => (
            <Radar key={s.key} name={s.name} dataKey={s.key} stroke={s.color} fill={s.color} fillOpacity={0.14} strokeWidth={2} />
          ))}
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Tooltip formatter={(v) => `${Math.round(v)}%`} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
