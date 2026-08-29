import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import { featureFlags } from './config/featureFlags'

const Login = lazy(() => import('./pages/Login'))
const Settings = lazy(() => import('./apps/Settings'))
const AgencyCommandCenter = lazy(() => import('./apps/AgencyCommandCenter'))
const UserManagement = lazy(() => import('./apps/UserManagement'))
const OperatingSpine = lazy(() => import('./apps/OperatingSpine'))
const DesignWorkshop = lazy(() => import('./apps/DesignWorkshop'))
const MarketingStudio = lazy(() => import('./apps/MarketingStudio'))
const ContentStudio = lazy(() => import('./apps/ContentStudio'))
const ArtifactDetail = lazy(() => import('./apps/ArtifactDetail'))
const DepartmentWorkshop = lazy(() => import('./apps/DepartmentWorkshop'))
const MyWork = lazy(() => import('./apps/MyWork'))
const AnkaSpherePortal = lazy(() => import('./apps/AnkaSpherePortal'))
const AnkaAssistant = lazy(() => import('./apps/AnkaAssistant'))
const LivingProductDocument = lazy(() => import('./apps/LivingProductDocument'))
const ReportsAndRecords = lazy(() => import('./apps/ReportsAndRecords'))

function RouteFallback() {
  return (
    <div className="flex h-full min-h-48 items-center justify-center bg-slate-950 text-sm text-slate-400">
      Loading workspace…
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  
  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>
  }
  
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      
      <Route 
        path="/" 
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        {/* Default redirect */}
        <Route index element={<Navigate to="/sphere/engagements" replace />} />

        {/* ADMIN */}
        <Route path="admin" element={<AgencyCommandCenter />} />
        <Route path="admin/living-product-document" element={<LivingProductDocument />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="settings" element={<Settings />} />

        {/* ANKA SPHERE */}
        <Route path="sphere/engagements" element={<OperatingSpine initialView="engagements" />} />
        <Route path="sphere/projects" element={<Navigate to="/sphere/engagements" replace />} />
        <Route path="sphere/my-work" element={<MyWork />} />
        <Route path="sphere/content" element={<DepartmentWorkshop departmentId="content" />} />
        <Route path="sphere/content/studio" element={<ContentStudio />} />
        <Route path="sphere/artifacts/:artifactId" element={<ArtifactDetail />} />
        <Route path="sphere/design" element={<DepartmentWorkshop departmentId="design" />} />
        <Route path="sphere/design/workshop" element={<DesignWorkshop />} />
        <Route path="sphere/marketing" element={<DepartmentWorkshop departmentId="marketing" />} />
        <Route path="sphere/marketing/studio" element={<MarketingStudio />} />
        <Route path="sphere/delivery" element={<DepartmentWorkshop departmentId="development" />} />
        <Route path="sphere/clients" element={<OperatingSpine initialView="clients" />} />
        <Route path="sphere/portal" element={<AnkaSpherePortal />} />
        <Route path="sphere/reports" element={<ReportsAndRecords />} />
        <Route path="sphere/team-board" element={<Navigate to="/sphere/my-work" replace />} />
        <Route path="sphere/figma" element={<Navigate to="/sphere/design" replace />} />
        <Route path="sphere/assets" element={<Navigate to="/sphere/design" replace />} />
        <Route path="sphere/moodboard" element={<Navigate to="/sphere/design" replace />} />
        <Route path="sphere/design-reviews" element={<Navigate to="/sphere/design" replace />} />
        <Route path="sphere/wp-sites" element={<Navigate to="/sphere/delivery" replace />} />
        <Route path="sphere/deployments" element={<Navigate to="/sphere/delivery" replace />} />
        <Route path="sphere/performance" element={<Navigate to="/sphere/delivery" replace />} />
        <Route path="sphere/campaigns" element={<Navigate to="/sphere/marketing/studio" replace />} />
        <Route path="sphere/calendar" element={<Navigate to="/sphere/marketing" replace />} />
        <Route path="sphere/seo" element={<Navigate to="/sphere/marketing" replace />} />

        {/* ANKA ASSISTANT */}
        <Route path="assistant" element={featureFlags.aiAssistance ? <AnkaAssistant /> : <Navigate to="/sphere/engagements" replace />} />

        <Route path="*" element={<Navigate to="/sphere/engagements" replace />} />
      </Route>
    </Routes>
    </Suspense>
  )
}
