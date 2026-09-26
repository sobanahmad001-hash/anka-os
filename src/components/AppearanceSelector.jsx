import { useId } from 'react'
import { useTheme } from '../hooks/useTheme.jsx'
export default function AppearanceSelector({ className = '', label = 'Appearance' }) {
  const id = useId()
  const { theme, setTheme, persistenceMessage } = useTheme()
  return <div className={`anka-appearance ${className}`}>
    <label htmlFor={id}>{label}</label>
    <select id={id} value={theme} onChange={event => { void setTheme(event.target.value) }} aria-describedby={`${id}-note`}>
      <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
    </select>
    <small id={`${id}-note`} role="status">{persistenceMessage || (theme === 'system' ? 'System preference is saved in this browser only.' : '')}</small>
  </div>
}
