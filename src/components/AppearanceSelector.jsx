import { useId } from 'react'
import { useTheme } from '../hooks/useTheme.jsx'
export default function AppearanceSelector({ className = '', label = 'Appearance', compact = false }) {
  const id = useId()
  const { theme, setTheme, persistenceMessage } = useTheme()
  return <div className={`anka-appearance ${compact ? 'anka-appearance-compact' : ''} ${className}`}>
    <label className={compact ? 'sr-only' : undefined} htmlFor={id}>{label}</label>
    <select id={id} value={theme} onChange={event => { void setTheme(event.target.value) }} aria-describedby={`${id}-note`}>
      <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
    </select>
    <small className={compact && !persistenceMessage ? 'sr-only' : undefined} id={`${id}-note`} role="status">{persistenceMessage || (theme === 'system' ? 'System preference is saved in this browser only.' : '')}</small>
  </div>
}
