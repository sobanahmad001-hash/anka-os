import { NavLink } from 'react-router-dom'

const CORE_APPS = [
  { name: 'Kanban', path: '/kanban', icon: '📋' },
  { name: 'Git', path: '/git', icon: '🌐' },
  { name: 'Terminal', path: '/terminal', icon: '🖥️' },
  { name: 'API Docs', path: '/api-docs', icon: '📖' },
  { name: 'Projects', path: '/projects', icon: '📁' },
  { name: 'Tasks', path: '/tasks', icon: '✅' },
  { name: 'Files', path: '/files', icon: '📂' },
]

export default function DevSidebar() {
  return (
    <div className="sidebar">
      <nav>
        {CORE_APPS.map(app => (
          <NavLink to={app.path} key={app.path}>
            <div className="sidebar-item">
              <span>{app.icon}</span>
              <span>{app.name}</span>
            </div>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
