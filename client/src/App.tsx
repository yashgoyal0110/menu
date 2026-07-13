import { Navigate, Route, Routes } from 'react-router-dom'

import { DashboardLayout } from './components/DashboardLayout'
import { useAuth } from './context/auth'
import { Account } from './pages/Account'
import { Billing } from './pages/Billing'
import { Login } from './pages/Login'
import { PublicCity } from './pages/PublicCity'
import { PublicStore } from './pages/PublicStore'
import { Register } from './pages/Register'
import { StoreDetail } from './pages/StoreDetail'
import { Stores } from './pages/Stores'
import { Verify } from './pages/Verify'

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <span className="spinner" />
      </div>
    )
  }
  return user ? <>{children}</> : <Navigate replace to="/sign-in" />
}

export function App() {
  return (
    <Routes>
      <Route element={<Navigate replace to="/dashboard/stores" />} path="/" />
      <Route element={<Login />} path="/sign-in" />
      <Route element={<Register />} path="/sign-up" />
      <Route element={<Verify />} path="/verify" />

      {/* Public, unauthenticated store pages */}
      <Route element={<PublicCity />} path="/stores/:city" />
      <Route element={<PublicStore />} path="/stores/:city/:idOrSlug" />

      {/* Authenticated dashboard (shared sidebar/topbar shell) */}
      <Route
        element={
          <Protected>
            <DashboardLayout />
          </Protected>
        }
        path="/dashboard"
      >
        <Route element={<Navigate replace to="/dashboard/stores" />} index />
        <Route element={<Stores />} path="stores" />
        <Route element={<StoreDetail />} path="stores/:id" />
        <Route element={<Billing />} path="billing" />
        <Route element={<Account />} path="account" />
      </Route>

      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  )
}
