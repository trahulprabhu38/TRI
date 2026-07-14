import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { SyncProvider, useSync } from './sync'
import Layout from './Layout'
import Dashboard from './pages/Dashboard'
import RacePredictions from './pages/RacePredictions'
import Physiology from './pages/Physiology'
import TrainingLoad from './pages/TrainingLoad'
import Sleep from './pages/Sleep'
import RaceAnalysis from './pages/RaceAnalysis'
import AICoach from './pages/AICoach'
import Connect from './pages/Connect'
import GarminConnect from './pages/GarminConnect'
import GarminTrends from './pages/GarminTrends'
import Maps from './pages/Maps'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </AuthProvider>
  )
}

function Root() {
  const { loading, user, stravaConfigured } = useAuth()

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="spinner" />
      </div>
    )
  }
  if (!user) return <Login />

  return (
    <Routes>
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="*" element={stravaConfigured ? <AppShell /> : <Navigate to="/onboarding" replace />} />
    </Routes>
  )
}

function AppShell() {
  return (
    <SyncProvider>
      <Layout>
        <ShellRoutes />
      </Layout>
    </SyncProvider>
  )
}

function ShellRoutes() {
  const { version } = useSync()
  // Keying on version remounts pages after a sync so every metric refetches.
  return (
    <Routes key={version}>
      <Route path="/" element={<Dashboard />} />
      <Route path="/maps" element={<Maps />} />
      <Route path="/races" element={<RaceAnalysis />} />
      <Route path="/predictions" element={<RacePredictions />} />
      <Route path="/physiology" element={<Physiology />} />
      <Route path="/training-load" element={<TrainingLoad />} />
      <Route path="/sleep" element={<Sleep />} />
      <Route path="/garmin-trends" element={<GarminTrends />} />
      <Route path="/coach" element={<AICoach />} />
      <Route path="/connect" element={<Connect />} />
      <Route path="/garmin" element={<GarminConnect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
