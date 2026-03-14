import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../hooks/useTheme.jsx';
import { usePresence } from '../hooks/usePresence.js';

const ROLE_LABELS = {
  admin: 'Administrator',
  department_head: 'Department Head',
  executive: 'Executive',
  intern: 'Intern',
};

const STATUS_OPTIONS = [
  { value: 'online', label: 'Online', color: 'bg-green-500' },
  { value: 'away', label: 'Away', color: 'bg-yellow-500' },
  { value: 'busy', label: 'Busy', color: 'bg-red-500' },
  { value: 'offline', label: 'Invisible', color: 'bg-gray-500' },
];

const SHORTCUTS = [
  { keys: '⌘/Ctrl + K', action: 'Global Search' },
  { keys: 'Double-click', action: 'Open desktop app' },
  { keys: '⌘/Ctrl + W', action: 'Close window (browser)' },
  { keys: 'Drag title bar', action: 'Move window' },
  { keys: 'Drag corner', action: 'Resize window' },
  { keys: '↑ / ↓', action: 'Navigate search results' },
  { keys: 'Enter', action: 'Select search result' },
  { keys: 'Esc', action: 'Close overlay / cancel' },
];

export default function SettingsApp() {
  const { user, profile, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { myStatus, updateStatus } = usePresence();
  const [tab, setTab] = useState('profile');
  const [name, setName] = useState(profile?.full_name || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [statusText, setStatusText] = useState('');

  // Notification prefs
  const [prefs, setPrefs] = useState({
    notification_sounds: true,
    notification_desktop: false,
    compact_mode: false,
  });

  useEffect(() => {
    if (!user) return;
    supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setPrefs({
            notification_sounds: data.notification_sounds,
            notification_desktop: data.notification_desktop,
            compact_mode: data.compact_mode,
          });
        }
      });
  }, [user]);

  async function saveName() {
    if (!name.trim()) return;
    setSaving(true);
    await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', user.id);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function togglePref(key) {
    const newVal = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: newVal }));
    await supabase
      .from('user_preferences')
      .upsert(
        { user_id: user.id, [key]: newVal, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
  }

  const TABS = [
    { id: 'profile', label: 'Profile', icon: '👤' },
    { id: 'appearance', label: 'Appearance', icon: '🎨' },
    { id: 'notifications', label: 'Notifications', icon: '🔔' },
    { id: 'shortcuts', label: 'Shortcuts', icon: '⌨️' },
    { id: 'about', label: 'About', icon: 'ℹ️' },
  ];

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <div className="w-48 bg-[var(--anka-bg-secondary)] border-r border-[var(--anka-border)] flex flex-col">
        <div className="p-3 border-b border-[var(--anka-border)]">
          <span className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase">Settings</span>
        </div>
        <div className="flex-1 p-2 space-y-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2 transition cursor-pointer ${
                tab === t.id
                  ? 'bg-[var(--anka-accent)]/15 text-[var(--anka-accent)]'
                  : 'text-[var(--anka-text-secondary)] hover:bg-[var(--anka-bg-tertiary)]'
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-[var(--anka-border)]">
          <button
            onClick={signOut}
            className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium rounded-lg transition cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
        {tab === 'profile' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">Profile</h2>

            {/* Avatar + Name */}
            <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-5">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[var(--anka-accent)] to-purple-500 flex items-center justify-center text-2xl font-bold">
                  {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div>
                  <div className="font-medium text-lg">{profile?.full_name || 'Unknown'}</div>
                  <div className="text-sm text-[var(--anka-text-secondary)]">
                    {ROLE_LABELS[profile?.role] || profile?.role || 'Member'} — <span className="capitalize">{profile?.department}</span>
                  </div>
                </div>
              </div>

              {/* Edit name */}
              <div className="space-y-2">
                <label className="text-xs text-[var(--anka-text-secondary)] uppercase font-semibold">Display Name</label>
                <div className="flex gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="flex-1 px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
                  />
                  <button
                    onClick={saveName}
                    disabled={saving}
                    className="px-4 py-2 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-xs font-medium rounded-lg transition cursor-pointer disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
                  </button>
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-5">
              <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase mb-3">Status</h3>
              <div className="flex gap-2 mb-3">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => updateStatus(s.value, statusText)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition cursor-pointer ${
                      myStatus === s.value
                        ? 'bg-[var(--anka-accent)]/15 text-[var(--anka-accent)] ring-1 ring-[var(--anka-accent)]/30'
                        : 'bg-[var(--anka-bg-tertiary)] text-[var(--anka-text-secondary)] hover:bg-[var(--anka-bg-tertiary)]/70'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${s.color}`} />
                    {s.label}
                  </button>
                ))}
              </div>
              <input
                value={statusText}
                onChange={(e) => setStatusText(e.target.value)}
                onBlur={() => updateStatus(myStatus, statusText)}
                placeholder="What are you working on?"
                className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
              />
            </div>

            {/* Account details */}
            <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-5">
              <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase mb-3">Account</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-[10px] text-[var(--anka-text-secondary)] uppercase mb-1">Department</div>
                  <div className="capitalize">{profile?.department || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--anka-text-secondary)] uppercase mb-1">Role</div>
                  <div>{ROLE_LABELS[profile?.role] || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--anka-text-secondary)] uppercase mb-1">User ID</div>
                  <div className="text-xs font-mono text-[var(--anka-text-secondary)]">{user?.id?.slice(0, 12)}...</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--anka-text-secondary)] uppercase mb-1">Joined</div>
                  <div className="text-xs">{profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'appearance' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">Appearance</h2>

            <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-5">
              <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase mb-4">Theme</h3>
              <div className="flex gap-3">
                {['dark', 'light'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={`flex-1 p-4 rounded-xl border-2 transition cursor-pointer ${
                      theme === t
                        ? 'border-[var(--anka-accent)] bg-[var(--anka-accent)]/10'
                        : 'border-[var(--anka-border)] hover:border-[var(--anka-accent)]/30'
                    }`}
                  >
                    <div className="text-2xl mb-2">{t === 'dark' ? '🌙' : '☀️'}</div>
                    <div className="text-sm font-medium capitalize">{t}</div>
                    <div className="text-[10px] text-[var(--anka-text-secondary)] mt-1">
                      {t === 'dark' ? 'Dark backgrounds, light text' : 'Light backgrounds, dark text'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-5">
              <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase mb-4">Display</h3>
              <ToggleRow
                label="Compact Mode"
                description="Reduce spacing and padding across the UI"
                checked={prefs.compact_mode}
                onChange={() => togglePref('compact_mode')}
              />
            </div>
          </div>
        )}

        {tab === 'notifications' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">Notifications</h2>

            <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-5 space-y-4">
              <ToggleRow
                label="Sound Alerts"
                description="Play a sound when new notifications arrive"
                checked={prefs.notification_sounds}
                onChange={() => togglePref('notification_sounds')}
              />
              <div className="border-t border-[var(--anka-border)]" />
              <ToggleRow
                label="Desktop Notifications"
                description="Show browser push notifications"
                checked={prefs.notification_desktop}
                onChange={() => togglePref('notification_desktop')}
              />
            </div>
          </div>
        )}

        {tab === 'shortcuts' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>

            <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl overflow-hidden">
              {SHORTCUTS.map((s, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between px-5 py-3 ${
                    i !== SHORTCUTS.length - 1 ? 'border-b border-[var(--anka-border)]' : ''
                  }`}
                >
                  <span className="text-sm">{s.action}</span>
                  <kbd className="px-2.5 py-1 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded text-xs font-mono text-[var(--anka-text-secondary)]">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'about' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">About Anka OS</h2>

            <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-5">
              <div className="text-center py-4">
                <div className="text-4xl mb-3">🦅</div>
                <div className="text-xl font-bold bg-gradient-to-r from-[var(--anka-accent)] to-purple-400 bg-clip-text text-transparent">
                  Anka OS
                </div>
                <div className="text-sm text-[var(--anka-text-secondary)] mt-2">Version 0.8.0</div>
                <div className="text-xs text-[var(--anka-text-secondary)] mt-1">Built by Anka Studio</div>
              </div>
            </div>

            <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-5">
              <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase mb-3">System Info</h3>
              <div className="text-sm space-y-2 text-[var(--anka-text-secondary)]">
                <div className="flex justify-between"><span>Frontend</span><span>React 19 + Vite 6</span></div>
                <div className="flex justify-between"><span>Styling</span><span>Tailwind CSS 4</span></div>
                <div className="flex justify-between"><span>Backend</span><span>Supabase (PostgreSQL)</span></div>
                <div className="flex justify-between"><span>Auth</span><span>Supabase Auth</span></div>
                <div className="flex justify-between"><span>Hosting</span><span>Vercel</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-[var(--anka-text-secondary)]">{description}</div>
      </div>
      <button
        onClick={onChange}
        className={`w-11 h-6 rounded-full transition relative cursor-pointer ${
          checked ? 'bg-[var(--anka-accent)]' : 'bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)]'
        }`}
      >
        <div
          className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${
            checked ? 'left-6' : 'left-1'
          }`}
        />
      </button>
    </div>
  );
}
