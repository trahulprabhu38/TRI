import { useState } from 'react'
import { api } from '../api'
import { useApi } from '../useApi'
import { Card, Loading, ErrorState } from '../components'
import { useSync } from '../sync'

// Live Garmin Connect sync — the only way data enters the app now.
export default function GarminConnect() {
  const { data, error, loading, reload } = useApi(() => api.garminConnectStatus(), [])
  const sync = useSync()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfa, setMfa] = useState('')
  const [needMfa, setNeedMfa] = useState(false)
  const [useToken, setUseToken] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)

  if (loading) return <Loading />
  if (error) return <ErrorState error={error} />

  if (!data.available) {
    return (
      <Card title="Garmin Connect" desc="Sync service not running">
        <div className="muted" style={{ fontSize: 13 }}>
          The Garmin sync service isn’t available. Start the stack with <code>docker compose up -d</code>
          (it includes a <code>garmin-sync</code> service) to connect your Garmin account.
        </div>
      </Card>
    )
  }

  async function connect() {
    if (!email || !password) { setMsg({ type: 'err', text: 'Enter your Garmin email and password.' }); return }
    setBusy('login'); setMsg(null)
    try {
      const r = await api.garminConnectLogin(email, password)
      if (r.status === 'mfa_required') { setNeedMfa(true); setMsg({ type: 'ok', text: 'Enter the verification code.' }) }
      else { setMsg({ type: 'ok', text: 'Connected to Garmin. Syncing…' }); setPassword(''); reload(); sync.refreshStatus(); autoSync() }
    } catch (e) { setMsg({ type: 'err', text: e.message }) }
    finally { setBusy('') }
  }
  async function submitMfa() {
    setBusy('mfa'); setMsg(null)
    try {
      await api.garminConnectMfa(mfa)
      setNeedMfa(false); setPassword(''); setMfa('')
      setMsg({ type: 'ok', text: 'Connected to Garmin. Syncing…' }); reload(); sync.refreshStatus(); autoSync()
    } catch (e) { setMsg({ type: 'err', text: e.message }) }
    finally { setBusy('') }
  }
  async function connectToken() {
    if (!token.trim()) { setMsg({ type: 'err', text: 'Paste your Garmin token.' }); return }
    setBusy('token'); setMsg(null)
    try {
      await api.garminConnectToken(token.trim())
      setToken(''); setUseToken(false)
      setMsg({ type: 'ok', text: 'Connected with token. Syncing…' }); reload(); sync.refreshStatus(); autoSync()
    } catch (e) { setMsg({ type: 'err', text: e.message }) }
    finally { setBusy('') }
  }
  async function autoSync() {
    // Kick off an initial sync right after connecting.
    try { await sync.doSync(); reload() } catch { /* surfaced elsewhere */ }
  }
  async function doSync() {
    setBusy('sync'); setMsg(null)
    try {
      await sync.doSync()
      const c = sync.lastCounts || {}
      setMsg({ type: 'ok', text: `Synced ${c.daily || 0} days, ${c.sleep || 0} nights, ${c.readiness || 0} readiness, ${c.vo2max || 0} VO₂, ${c.trainingLoad || 0} load points.` })
      reload()
    } catch (e) { setMsg({ type: 'err', text: e.message }) }
    finally { setBusy('') }
  }
  async function disconnect() {
    setBusy('dc'); setMsg(null)
    try { await api.garminConnectDisconnect(); reload(); sync.refreshStatus() } finally { setBusy('') }
  }

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card title="Garmin Connect" desc="Log in once, then your data syncs straight from Garmin">
        <div className="row" style={{ margin: '8px 0 16px', gap: 8, flexWrap: 'wrap' }}>
          <span className={`badge ${data.connected ? 'good' : 'neutral'}`}>{data.connected ? '● Connected to Garmin' : '○ Not connected'}</span>
          {data.hasData && <span className="badge excellent">● Live data active</span>}
        </div>

        {!data.connected ? (
          useToken ? (
            <div>
              <label className="field">Paste your Garmin token</label>
              <textarea className="input" rows={4} value={token} onChange={(e) => setToken(e.target.value)}
                placeholder="Paste the long token string from the one-liner below…" />
              <div className="row" style={{ marginTop: 12, gap: 10 }}>
                <button className="btn accent" disabled={busy === 'token'} onClick={connectToken}>{busy === 'token' ? 'Connecting…' : 'Connect with token'}</button>
                <button className="btn ghost" onClick={() => setUseToken(false)}>Back to email login</button>
              </div>
              <div className="card-pad" style={{ background: 'var(--surface-2)', borderRadius: 10, marginTop: 14, fontSize: 12.5, lineHeight: 1.7 }}>
                <b>Generate your token once</b> (on your own computer — a 6-digit code, if asked, comes from your authenticator app):
                <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0', fontSize: 12 }}>{`pip install garminconnect
python3 -c "from garminconnect import Garmin; g=Garmin('YOUR_EMAIL','YOUR_PASSWORD', prompt_mfa=lambda: input('MFA code: ')); g.login(); print(g.client.dumps())"`}</pre>
                <div className="muted" style={{ marginTop: 6 }}>Copy the long token line it prints and paste it above. No password is sent to this app.</div>
              </div>
            </div>
          ) : !needMfa ? (
            <div style={{ maxWidth: 380 }}>
              <label className="field">Garmin email</label>
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="off" />
              <label className="field" style={{ marginTop: 12 }}>Garmin password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="off" />
              <div className="row" style={{ marginTop: 14, gap: 10 }}>
                <button className="btn accent" disabled={busy === 'login'} onClick={connect}>{busy === 'login' ? 'Connecting…' : 'Connect Garmin'}</button>
                <button className="btn ghost" onClick={() => setUseToken(true)}>Use a token instead</button>
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>Not getting a code? Use the token method — no code needed.</div>
            </div>
          ) : (
            <div style={{ maxWidth: 340 }}>
              <label className="field">Garmin verification code</label>
              <input className="input" value={mfa} onChange={(e) => setMfa(e.target.value)} placeholder="6-digit code" />
              <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                The code is in your <b>authenticator app</b> (Google Authenticator / Authy) or emailed to you (check spam).
                Not receiving it? <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => { setNeedMfa(false); setUseToken(true) }}>Use a token instead</button>
              </div>
              <button className="btn accent" style={{ marginTop: 14 }} disabled={busy === 'mfa'} onClick={submitMfa}>{busy === 'mfa' ? 'Verifying…' : 'Verify'}</button>
            </div>
          )
        ) : (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button className="btn accent" disabled={busy === 'sync' || sync.syncing} onClick={doSync}>{(busy === 'sync' || sync.syncing) ? 'Syncing… (up to a few min)' : '↻ Sync now'}</button>
            {data.hasData && <button className="btn ghost" disabled={busy === 'dc'} onClick={disconnect}>Disconnect</button>}
          </div>
        )}

        {msg && <div className={`badge ${msg.type === 'ok' ? 'good' : 'bad'}`} style={{ display: 'block', padding: 12, marginTop: 14 }}>{msg.text}</div>}

        <div className="muted" style={{ fontSize: 11.5, marginTop: 16, lineHeight: 1.6 }}>
          Garmin has no public API, so this uses the open-source <code>garminconnect</code> login (read-only). Your password is
          only used to obtain a session token — the token is stored, the password is not. Every metric on the dashboard updates
          from this sync.
        </div>
      </Card>

      <Card title="What syncs" desc="Pulled live from your Garmin account">
        <ul style={{ margin: '4px 0 0 18px', color: 'var(--text-2)', fontSize: 13, lineHeight: 2 }}>
          <li>VO₂ max &amp; race predictions</li>
          <li>HRV, resting HR, respiration &amp; stress</li>
          <li>Sleep stages &amp; sleep score</li>
          <li>Training readiness &amp; recovery</li>
          <li>Training load &amp; ACWR</li>
          <li>Body battery, steps &amp; daily activity</li>
        </ul>
        <div className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          Press <b>Sync</b> (top-right, on any page) to pull the latest. The last-synced time shows underneath it.
        </div>
      </Card>
    </div>
  )
}
