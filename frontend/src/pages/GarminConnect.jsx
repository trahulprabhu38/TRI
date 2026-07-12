import { useRef, useState } from 'react'
import { api } from '../api'
import { useApi } from '../useApi'
import { Card, Loading, ErrorState, StatRow } from '../components'

export default function GarminConnect() {
  const { data, error, loading, reload } = useApi(() => api.garminStatus(), [])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [drag, setDrag] = useState(false)
  const zipRef = useRef()
  const filesRef = useRef()
  const folderRef = useRef()

  if (loading) return <Loading />
  if (error) return <ErrorState error={error} />

  async function sendFiles(fileList) {
    const files = Array.from(fileList || [])
    if (files.length === 0) return
    const form = new FormData()
    let added = 0
    for (const f of files) {
      const n = f.name.toLowerCase()
      if (n.endsWith('.zip') || n.endsWith('.json')) { form.append('files', f, f.name); added++ }
    }
    if (added === 0) { setMsg({ type: 'err', text: 'Select .zip or .json files (or a folder containing them).' }); return }
    setBusy(true); setMsg(null)
    try {
      const r = await api.garminUpload(form)
      setMsg({ type: 'ok', text: `Imported ${r.imported} JSON files${r.zips ? ` from ${r.zips} zip(s)` : ''}. Your metrics are now up to date.` })
      reload()
    } catch (e) {
      setMsg({ type: 'err', text: e.message })
    } finally { setBusy(false) }
  }

  async function clearData() {
    if (!confirm('Remove your uploaded Garmin data and revert to the sample?')) return
    setBusy(true); setMsg(null)
    try { await api.garminClear(); setMsg({ type: 'ok', text: 'Reverted to sample data.' }); reload() }
    catch (e) { setMsg({ type: 'err', text: e.message }) }
    finally { setBusy(false) }
  }

  function onDrop(e) {
    e.preventDefault(); setDrag(false)
    sendFiles(e.dataTransfer.files)
  }

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card title="Garmin Connect" desc="Upload your Garmin export to keep your metrics up to date">
        <div className="row" style={{ margin: '8px 0 16px' }}>
          <span className={`badge ${data.hasData ? 'good' : 'neutral'}`}>
            {data.hasData ? `● Your data · ${data.fileCount} files` : '○ Using sample data'}
          </span>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          style={{
            border: `1.5px dashed ${drag ? 'var(--accent)' : 'var(--border-strong)'}`,
            background: drag ? 'var(--accent-soft)' : 'var(--surface-2)',
            borderRadius: 12, padding: '28px 20px', textAlign: 'center', transition: 'all .12s',
          }}
        >
          <div style={{ fontSize: 26, marginBottom: 6 }}>⬆️</div>
          <div style={{ fontWeight: 600 }}>Drop your Garmin <code>.zip</code> or JSON files here</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>…or choose below. Re-upload anytime to refresh.</div>
        </div>

        <div className="row" style={{ marginTop: 16, flexWrap: 'wrap', gap: 10 }}>
          <button className="btn accent" disabled={busy} onClick={() => zipRef.current.click()}>
            {busy ? 'Uploading…' : 'Upload .zip'}
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => folderRef.current.click()}>Upload folder</button>
          <button className="btn ghost" disabled={busy} onClick={() => filesRef.current.click()}>Upload JSON files</button>
          {data.hasData && <button className="btn ghost" disabled={busy} onClick={clearData}>Revert to sample</button>}
        </div>

        <input ref={zipRef} type="file" accept=".zip" hidden onChange={(e) => sendFiles(e.target.files)} />
        <input ref={filesRef} type="file" accept=".json" multiple hidden onChange={(e) => sendFiles(e.target.files)} />
        {/* webkitdirectory (set imperatively) lets the user pick whole folders */}
        <input
          ref={(el) => { if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', '') } folderRef.current = el }}
          type="file" hidden multiple onChange={(e) => sendFiles(e.target.files)}
        />

        {msg && <div className={`badge ${msg.type === 'ok' ? 'good' : 'bad'}`} style={{ display: 'block', padding: 12, marginTop: 16 }}>{msg.text}</div>}
      </Card>

      <Card title="How to export from Garmin" desc="Two easy ways to get your data">
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Option A — Garmin data export</div>
        <ol style={{ margin: '0 0 16px 18px', color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.8 }}>
          <li>Sign in at <code>connect.garmin.com</code>.</li>
          <li>Go to your account → <b>Manage Your Data</b> → <b>Export Your Data</b> (or use Garmin’s data-export request).</li>
          <li>You’ll receive a <code>.zip</code>. Upload it here as-is — I’ll unzip and read every JSON.</li>
        </ol>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Option B — the JSON files directly</div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
          If you already have the individual files (like <code>RunRacePredictions…json</code>, <code>…sleepData.json</code>,
          <code>UDSFile…json</code>), select them or the whole folder. Only <code>.json</code> files are read; everything else is ignored.
        </p>
        <div className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          Uploading merges/overwrites by filename, so monthly exports keep your dashboard current. Your files are stored privately under your account.
        </div>
      </Card>
    </div>
  )
}
