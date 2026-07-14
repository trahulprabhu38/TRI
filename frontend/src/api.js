// Thin API client for the Go backend. In dev, /api is proxied by Vite.
const BASE = import.meta.env.VITE_API_BASE || ''

// A 401 means "not logged in" — surface it as a typed error the auth layer handles.
export class AuthError extends Error {}

async function req(path, options = {}) {
  const res = await fetch(`${BASE}/api${path}`, { credentials: 'include', ...options })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) throw new AuthError(data.error || 'not authenticated')
  if (!res.ok) throw new Error(data.error || `${path} failed: ${res.status}`)
  return data
}

const get = (path) => req(path)
const post = (path, body) =>
  req(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })

export const api = {
  // auth
  authConfig: () => get('/auth/config'),
  me: () => get('/auth/me'),
  googleLogin: (credential) => post('/auth/google', { credential }),
  logout: () => post('/auth/logout', {}),
  // garmin live sync (garminconnect)
  garminConnectStatus: () => get('/garmin/connect/status'),
  garminConnectLogin: (email, password) => post('/garmin/connect/login', { email, password }),
  garminConnectMfa: (code) => post('/garmin/connect/mfa', { code }),
  garminConnectToken: (token) => post('/garmin/connect/token', { token }),
  garminConnectSync: (days) => post('/garmin/connect/sync', { days }),
  garminConnectDisconnect: () => post('/garmin/connect/disconnect', {}),
  // strava credentials
  stravaCredentials: () => get('/strava/credentials'),
  saveStravaCredentials: (clientId, clientSecret) => post('/strava/credentials', { clientId, clientSecret }),
  // metrics
  overview: () => get('/overview'),
  profile: () => get('/profile'),
  racePredictions: () => get('/race-predictions'),
  vo2max: () => get('/vo2max'),
  physiology: () => get('/physiology'),
  trainingLoad: () => get('/training-load'),
  readiness: () => get('/readiness'),
  sleep: () => get('/sleep'),
  // races
  races: () => get('/races'),
  compareRaces: () => get('/races/compare'),
  uploadRace: (payload) => post('/races/upload', payload),
  analyzeRaces: (ids) => post('/races/analyze', { ids }),
  // strava
  stravaStatus: () => get('/strava/status'),
  stravaAuthUrl: () => get('/strava/auth-url'),
  stravaSync: () => post('/strava/sync', {}),
  stravaDisconnect: () => post('/strava/disconnect', {}),
  // ai
  aiInsights: (payload) => post('/ai/insights', payload),
}
