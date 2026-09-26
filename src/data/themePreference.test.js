import test from 'node:test'
import assert from 'node:assert/strict'
import { readThemePreference, writeThemePreference, resolveTheme, validTheme, themeStorageKey } from './themePreference.js'
test('theme preferences validate values, scope storage by account and tolerate unavailable storage', () => {
  const values = new Map([['anka-theme', 'dark'], [themeStorageKey('a'), 'light']])
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  assert.equal(readThemePreference(storage, ''), 'dark'); assert.equal(readThemePreference(storage, 'a'), 'light')
  assert.equal(readThemePreference(storage, 'b'), null); assert.equal(validTheme('invalid'), null)
  assert.equal(writeThemePreference(storage, 'b', 'system'), true); assert.equal(readThemePreference(storage, 'b'), 'system')
  const blocked = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') } }
  assert.equal(readThemePreference(blocked, 'a'), null); assert.equal(writeThemePreference(blocked, 'a', 'dark'), false)
  assert.equal(resolveTheme('system', false), 'light'); assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('light', true), 'light'); assert.equal(resolveTheme('dark', false), 'dark')
})
