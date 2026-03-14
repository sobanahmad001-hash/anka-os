import { useState } from 'react';

export default function AppLauncher({ apps, onOpenApp, onClose }) {
  const [search, setSearch] = useState('');

  const filtered = search
    ? apps.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
    : apps;

  return (
    <div
      className="absolute bottom-14 left-3 anka-glass-heavy anka-slide-up z-[9998]"
      style={{
        width: 320,
        borderRadius: 16,
        border: '1px solid var(--anka-border)',
        boxShadow: 'var(--anka-shadow-xl)',
        overflow: 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Search input */}
      <div style={{ padding: '12px 14px 8px' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search apps..."
          autoFocus
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid var(--anka-border)',
            background: 'var(--anka-bg-surface)',
            color: 'var(--anka-text-primary)',
            fontSize: 12,
            outline: 'none',
          }}
          onFocus={(e) => { e.target.style.borderColor = 'var(--anka-border-accent)'; }}
          onBlur={(e) => { e.target.style.borderColor = 'var(--anka-border)'; }}
        />
      </div>

      {/* App grid */}
      <div style={{ padding: '4px 10px 10px', maxHeight: 340, overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2 }}>
          {filtered.map((app) => (
            <button
              key={app.id}
              onClick={() => { onOpenApp(app); onClose(); }}
              className="cursor-pointer"
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '12px 4px 10px', borderRadius: 12, background: 'transparent',
                border: 'none', color: 'inherit', transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--anka-bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 24, lineHeight: 1 }}>{app.icon}</span>
              <span style={{
                fontSize: 10, fontWeight: 500, color: 'var(--anka-text-secondary)',
                width: '100%', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {app.name}
              </span>
            </button>
          ))}
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--anka-text-tertiary)' }}>
            No apps found
          </div>
        )}
      </div>
    </div>
  );
}
