import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import { useSync, timeAgo } from './sync'

function SyncControl() {
  const s = useSync()
  if (!s || !s.available) return null
  const line = s.error
    ? s.error
    : !s.connected
      ? 'Garmin not connected'
      : s.lastSync
        ? `Last synced ${timeAgo(s.lastSync)}`
        : 'Not synced yet'
  return (
    <div style={{ textAlign: 'right' }}>
      <button
        className="btn accent"
        style={{ padding: '8px 16px' }}
        disabled={s.syncing || !s.connected}
        onClick={() => s.doSync().catch(() => {})}
      >
        {s.syncing ? 'Syncing…' : '↻ Sync'}
      </button>
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{line}</div>
    </div>
  )
}

const NAV = [
  { section: 'Overview' },
  { to: '/', label: 'Dashboard', icon: '◎', end: true },
  { to: '/maps', label: 'Maps', icon: '🗺️' },
  { to: '/races', label: 'Race Analysis', icon: '🏁' },
  { section: 'Performance' },
  { to: '/predictions', label: 'Race Predictions', icon: '📈' },
  { to: '/physiology', label: 'Physiology', icon: '❤️' },
  { to: '/training-load', label: 'Training Load', icon: '⚡' },
  { to: '/sleep', label: 'Sleep & Recovery', icon: '😴' },
  { to: '/garmin-trends', label: 'Garmin Trends', icon: '📊' },
  { section: 'Coaching' },
  { to: '/coach', label: 'AI Coach', icon: '✨' },
  { section: 'Data' },
  { to: '/connect', label: 'Connect Strava', icon: '🔗' },
  { to: '/garmin', label: 'Garmin Connect', icon: '⌚' },
]

const TITLES = {
  '/': ['Dashboard', 'Your triathlon fitness at a glance'],
  '/maps': ['Maps', 'Your routes and where you train'],
  '/races': ['Race Analysis', 'Compare races and track personal records'],
  '/predictions': ['Race Predictions', 'Projected race times and month-over-month trends'],
  '/physiology': ['Physiology', 'VO₂ max, HRV, heart rate, cadence and more'],
  '/training-load': ['Training Load', 'Acute vs chronic load, ACWR and readiness'],
  '/sleep': ['Sleep & Recovery', 'Sleep quality, stages, and hydration'],
  '/garmin-trends': ['Garmin Trends', 'Deep breakdown of every Garmin metric'],
  '/coach': ['AI Coach', 'Personalized analysis and training plans'],
  '/connect': ['Connect Strava', 'Sync your Garmin activities via Strava'],
  '/garmin': ['Garmin Connect', 'Upload your Garmin export to power your metrics'],
}

export default function Layout({ children }) {
  const { pathname } = useLocation()
  const { user, logout } = useAuth()
  const [title, sub] = TITLES[pathname] || ['Garmin Analyzer', '']

  return (
    <div className="app">
      <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="brand">
          <div className="brand-mark">TRI</div>
          <div>
            <div className="brand-name">Tri</div>
            <div className="brand-sub">Garmin performance lab</div>
          </div>
        </div>
        <nav style={{ flex: 1 }}>
          {NAV.map((item, i) =>
            item.section ? (
              <div key={i} className="nav-section">{item.section}</div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <span className="ico">{item.icon}</span>
                {item.label}
              </NavLink>
            )
          )}
        </nav>
        {user && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
            <div className="row" style={{ padding: '4px 8px' }}>
              {user.picture
                ? <img src={user.picture} alt="" style={{ width: 30, height: 30, borderRadius: '50%' }} />
                : <div className="brand-mark" style={{ width: 30, height: 30, fontSize: 12 }}>{(user.name || '?')[0]}</div>}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
                <div className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
              </div>
            </div>
            <button className="nav-item" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }} onClick={logout}>
              <span className="ico">⎋</span> Sign out
            </button>
          </div>
        )}
      </aside>
      <div className="main">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <SyncControl />
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  )
}
