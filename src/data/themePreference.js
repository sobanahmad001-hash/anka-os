export const THEME_PREFERENCES = Object.freeze(['system', 'light', 'dark'])
export const validTheme = value => THEME_PREFERENCES.includes(value) ? value : null
export const themeStorageKey = userId => `anka-theme:${userId || 'guest'}`
export function readThemePreference(storage, userId) {
  try {
    const scoped = validTheme(storage?.getItem(themeStorageKey(userId)))
    return scoped || (!userId ? validTheme(storage?.getItem('anka-theme')) : null)
  } catch { return null }
}
export function writeThemePreference(storage, userId, preference) {
  if (!validTheme(preference)) return false
  try { if (!storage) return false; storage.setItem(themeStorageKey(userId), preference); return true } catch { return false }
}
export function browserStorage() { try { return globalThis.localStorage } catch { return null } }
export function prefersDark() { try { return Boolean(globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches) } catch { return false } }
export const resolveTheme = (preference, dark) => preference === 'system' ? dark ? 'dark' : 'light' : validTheme(preference) || 'light'
