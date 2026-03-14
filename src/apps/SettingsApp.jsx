import { useAuth } from '../context/AuthContext.jsx';

export default function SettingsApp() {
  const { profile, signOut } = useAuth();

  const ROLE_LABELS = {
    admin: 'Administrator',
    department_head: 'Department Head',
    executive: 'Executive',
    intern: 'Intern',
  };

  return (
    <div className="h-full p-6 max-w-lg">
      <h2 className="text-lg font-semibold mb-6">Settings</h2>

      {/* Profile section */}
      <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-5 mb-4">
        <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase mb-4">
          Profile
        </h3>
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[var(--anka-accent)] to-purple-500 flex items-center justify-center text-xl font-bold">
              {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div>
              <div className="font-medium">{profile?.full_name || 'Unknown'}</div>
              <div className="text-sm text-[var(--anka-text-secondary)]">
                {ROLE_LABELS[profile?.role] || profile?.role || 'Member'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[var(--anka-border)]">
            <div>
              <div className="text-[10px] text-[var(--anka-text-secondary)] uppercase">Department</div>
              <div className="text-sm capitalize">{profile?.department || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--anka-text-secondary)] uppercase">Role</div>
              <div className="text-sm">{ROLE_LABELS[profile?.role] || '—'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* About */}
      <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-5 mb-4">
        <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase mb-3">
          About Anka OS
        </h3>
        <div className="text-sm text-[var(--anka-text-secondary)] space-y-1">
          <div>Version 0.1.0 (MVP)</div>
          <div>Built by Anka Studio</div>
        </div>
      </div>

      {/* Sign out */}
      <button
        onClick={signOut}
        className="w-full py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-xl transition cursor-pointer"
      >
        Sign Out
      </button>
    </div>
  );
}
