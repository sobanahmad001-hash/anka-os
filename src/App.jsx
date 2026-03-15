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
import Header from './components/Header'
import Terminal from './apps/Terminal'

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
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="projects" element={<Projects />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="chat" element={<Chat />} />
        <Route path="files" element={<Files />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="time-tracker" element={<TimeTracker />} />
        <Route path="clients" element={<Clients />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="dev-dashboard" element={<DevDashboard />} />
        <Route path="kanban" element={<Kanban />} />
        <Route path="api-docs" element={<ApiDocs />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="git" element={<GitIntegration />} />
        <Route path="terminal" element={<Terminal />} />
        <Route path="admin" element={<AdminDashboard />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
