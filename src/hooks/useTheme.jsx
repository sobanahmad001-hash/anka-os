import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { browserStorage, prefersDark, readThemePreference, resolveTheme, validTheme, writeThemePreference } from '../data/themePreference.js'
const ThemeContext = createContext(null)
export function ThemeProvider({ children }) {
  const { user } = useAuth()
  const userId = user?.id || ''
  const [choice, setChoice] = useState(() => ({ userId, theme: readThemePreference(browserStorage(), userId) || 'system' }))
  const [systemDark, setSystemDark] = useState(prefersDark)
  const [failure, setFailure] = useState(null)
  const writes = useRef(new Map())
  const current = useRef({ userId, generation: 0 })
  if (current.current.userId !== userId) current.current = { userId, generation: current.current.generation + 1 }
  const theme = choice.userId === userId ? choice.theme : readThemePreference(browserStorage(), userId) || 'system'
  const resolvedTheme = resolveTheme(theme, systemDark)
  useEffect(() => {
    const cached = readThemePreference(browserStorage(), userId)
    setChoice({ userId, theme: cached || 'system' })
    setFailure(null)
    const generation = current.current.generation
    let active = true
    if (userId) Promise.resolve().then(() => supabase.from('user_preferences').select('theme').eq('user_id', userId).maybeSingle())
      .then(({ data, error }) => {
        if (!active || current.current.userId !== userId || current.current.generation !== generation) return
        if (error) { setFailure({ userId, message: 'Account appearance could not be loaded. Your browser choice remains active.' }); return }
        const saved = validTheme(data?.theme)
        if (!cached && saved) { setChoice({ userId, theme: saved }); writeThemePreference(browserStorage(), userId, saved) }
      }).catch(() => { if (active && current.current.userId === userId && current.current.generation === generation) setFailure({ userId, message: 'Account appearance could not be loaded. Your browser choice remains active.' }) })
    return () => { active = false }
  }, [userId])
  useEffect(() => {
    if (theme !== 'system') return
    let media
    try { media = globalThis.matchMedia?.('(prefers-color-scheme: dark)') } catch { return }
    if (!media) { setSystemDark(false); return }
    const update = () => setSystemDark(Boolean(media.matches))
    update()
    if (media.addEventListener) media.addEventListener('change', update)
    else media.addListener?.(update)
    return () => { if (media.removeEventListener) media.removeEventListener('change', update); else media.removeListener?.(update) }
  }, [theme])
  useEffect(() => {
    globalThis.document?.documentElement?.setAttribute('data-theme', resolvedTheme)
    globalThis.document?.documentElement?.setAttribute('data-theme-preference', theme)
  }, [theme, resolvedTheme])
  const setTheme = useCallback(async value => {
    if (!validTheme(value)) return false
    const generation = ++current.current.generation
    setChoice({ userId, theme: value })
    const stored = writeThemePreference(browserStorage(), userId, value)
    setFailure(stored ? null : { userId, message: 'Appearance changed for this session; browser storage is unavailable.' })
    // The installed preference contract accepts only light/dark. Never send system.
    if (!userId || value === 'system') return stored
    const previous = writes.current.get(userId) || Promise.resolve()
    const pending = previous.catch(() => {}).then(async () => {
      const { error } = await supabase.from('user_preferences').upsert({ user_id: userId, theme: value, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      if (error) throw error
    })
    writes.current.set(userId, pending)
    try { await pending; return true } catch {
      if (current.current.userId === userId && current.current.generation === generation) setFailure({ userId, message: 'Appearance changed here, but the account preference could not be saved.' })
      return false
    }
  }, [userId])
  const toggleTheme = useCallback(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'), [resolvedTheme, setTheme])
  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme, persistenceMessage: failure?.userId === userId ? failure.message : '', systemPreferenceBrowserOnly: true }}>{children}</ThemeContext.Provider>
}
export function useTheme() { const context = useContext(ThemeContext); if (!context) throw new Error('useTheme must be used within ThemeProvider'); return context }
