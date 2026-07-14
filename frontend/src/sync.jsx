import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api } from './api'

const SyncCtx = createContext(null)

export function SyncProvider({ children }) {
  const [status, setStatus] = useState({ available: false, connected: false, hasData: false, lastSync: null })
  const [syncing, setSyncing] = useState(false)
  const [version, setVersion] = useState(0) // bump to force pages to refetch
  const [lastCounts, setLastCounts] = useState(null)
  const [error, setError] = useState(null)

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.garminConnectStatus()
      setStatus({ available: !!s.available, connected: !!s.connected, hasData: !!s.hasData, lastSync: s.lastSync || null })
    } catch { /* not logged in yet */ }
  }, [])

  useEffect(() => { refreshStatus() }, [refreshStatus])

  const doSync = useCallback(async () => {
    setError(null); setSyncing(true)
    try {
      const r = await api.garminConnectSync(28)
      setLastCounts(r.counts || {})
      await refreshStatus()
      setVersion((v) => v + 1) // remount pages so every metric refreshes
      return r
    } catch (e) {
      setError(e.message)
      throw e
    } finally {
      setSyncing(false)
    }
  }, [refreshStatus])

  return (
    <SyncCtx.Provider value={{ ...status, syncing, version, lastCounts, error, doSync, refreshStatus }}>
      {children}
    </SyncCtx.Provider>
  )
}

export const useSync = () => useContext(SyncCtx)

// Short "time ago" for the last-synced line.
export function timeAgo(iso) {
  if (!iso) return null
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 90) return '1 min ago'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 5400) return '1 hour ago'
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`
  if (s < 172800) return 'yesterday'
  return `${Math.round(s / 86400)} days ago`
}
