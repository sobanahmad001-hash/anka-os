import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Header from './Header'
import Sidebar from './Sidebar'
import AssistantFloat from './AssistantFloat'
import OrganizationGate from './OrganizationGate'
import './workspaceShell.css'

export default function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  return (
    <div className="anka-shell flex h-screen flex-col overflow-hidden">
      <a className="shell-skip-link" href="#main-workspace">Skip to workspace</a>
      <Header sidebarCollapsed={sidebarCollapsed} onToggleSidebar={() => setSidebarCollapsed(value => !value)} />
      <OrganizationGate>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar collapsed={sidebarCollapsed} />
          <main id="main-workspace" className="anka-workspace relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain" tabIndex="-1">
            <Outlet />
          </main>
        </div>
        <AssistantFloat />
      </OrganizationGate>
    </div>
  )
}
