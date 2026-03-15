import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Header() {
  const { profile, signOut } = useAuth()

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Anka OS</h1>
        <nav className="flex gap-4">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `px-3 py-2 rounded text-sm font-medium ${
                isActive
                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/dev-dashboard"
            className={({ isActive }) =>
              `px-3 py-2 rounded text-sm font-medium ${
                isActive
                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`
            }
          >
            💻 Dev
          </NavLink>
          {profile?.role === 'admin' && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `px-3 py-2 rounded text-sm font-medium ${
                  isActive
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`
              }
            >
              ⚙️ Admin
            </NavLink>
          )}
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-700 dark:text-gray-300">{profile?.full_name || profile?.email}</span>
        <button
          onClick={signOut}
          className="px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
        >
          Sign Out
        </button>
      </div>
    </header>
  )
}
