import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'

// Import existing app components
import Dashboard from './apps/Dashboard'
import Projects from './apps/Projects'
import Tasks from './apps/Tasks'
import Chat from './apps/Chat'
import Files from './apps/Files'
import Calendar from './apps/Calendar'
import TimeTracker from './apps/TimeTracker'
import Clients from './apps/Clients'
import Campaigns from './apps/Campaigns'
import Settings from './apps/Settings'
import AdminDashboard from './apps/AdminDashboard'
import DevDashboard from './apps/DevDashboard'
import GitIntegration from './apps/GitIntegration'
import Kanban from './apps/Kanban'
import ApiDocs from './apps/ApiDocs'
import UserManagement from './apps/UserManagement'
import Terminal from './apps/Terminal'
import AnkaSphereProjects from './apps/AnkaSphereProjects'
import AnkaSphereTeamBoard from './apps/AnkaSphereTeamBoard'
import AnkaSpherePortal from './apps/AnkaSpherePortal'
import AnkaSphereClients from './apps/AnkaSphereClients'
import CodingAgent from './apps/CodingAgent'
import SphereCreativeStudio from './apps/SphereCreativeStudio'
import SphereWPEngine from './apps/SphereWPEngine'
import SphereMarketing from './apps/SphereMarketing'
import SphereFigmaWorkspace from './apps/SphereFigmaWorkspace'
import AnkaAssistant from './apps/AnkaAssistant'
import LivingProductDocument from './apps/LivingProductDocument'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  
  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>
  }
  
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
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
        <Route index element={<Navigate to="/diversify/projects" replace />} />

        {/* ADMIN */}
        <Route path="admin" element={<AdminDashboard />} />
        <Route path="admin/living-product-document" element={<LivingProductDocument />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="settings" element={<Settings />} />

        {/* ANKA SPHERE */}
        <Route path="sphere/projects" element={<AnkaSphereProjects />} />
        <Route path="sphere/clients" element={<AnkaSphereClients />} />
        <Route path="sphere/portal" element={<AnkaSpherePortal />} />
        <Route path="sphere/team-board" element={<AnkaSphereTeamBoard />} />
        <Route path="sphere/figma" element={<SphereFigmaWorkspace />} />
        <Route path="sphere/assets" element={<SphereCreativeStudio />} />
        <Route path="sphere/moodboard" element={<SphereCreativeStudio />} />
        <Route path="sphere/design-reviews" element={<SphereCreativeStudio />} />
        <Route path="sphere/wp-sites" element={<SphereWPEngine />} />
        <Route path="sphere/deployments" element={<SphereWPEngine />} />
        <Route path="sphere/performance" element={<SphereWPEngine />} />
        <Route path="sphere/campaigns" element={<SphereMarketing />} />
        <Route path="sphere/content" element={<SphereMarketing />} />
        <Route path="sphere/calendar" element={<SphereMarketing />} />
        <Route path="sphere/seo" element={<SphereMarketing />} />

        {/* ANKA DIVERSIFY */}
        <Route path="diversify/projects" element={<Projects />} />
        <Route path="diversify/agent" element={<CodingAgent />} />
        <Route path="diversify/kanban" element={<Kanban />} />
        <Route path="diversify/git" element={<GitIntegration />} />
        <Route path="diversify/api-docs" element={<ApiDocs />} />
        <Route path="diversify/terminal" element={<Terminal />} />

        {/* ANKA ASSISTANT */}
        <Route path="assistant" element={<AnkaAssistant />} />
      </Route>
    </Routes>
  )
}
