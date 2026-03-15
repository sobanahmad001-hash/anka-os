import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import AiAssistantApp from '../apps/AiAssistantApp.jsx';

export default function Layout() {
  const [aiOpen, setAiOpen] = useState(false);

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      background: 'var(--anka-bg-primary)',
      overflow: 'hidden',
    }}>
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Content Area */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minWidth: 0,
      }}>
        {/* Top bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '10px 16px',
          borderBottom: '1px solid var(--anka-border)',
          background: 'var(--anka-bg-secondary)',
          flexShrink: 0,
        }}>
          <button
            onClick={() => setAiOpen((s) => !s)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              background: aiOpen ? 'var(--anka-accent-muted)' : 'var(--anka-bg-tertiary)',
              border: '1px solid var(--anka-border-accent)',
              borderRadius: 8,
              color: aiOpen ? 'var(--anka-accent)' : 'var(--anka-text-secondary)',
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontWeight: aiOpen ? 500 : 400,
            }}
          >
            <span>🤖</span>
            <span>AI Assistant</span>
          </button>
        </div>

        {/* Page content */}
        <main style={{
          flex: 1,
          overflowY: 'auto',
          padding: 24,
        }}>
          <Outlet />
        </main>
      </div>

      {/* AI Assistant Panel */}
      {aiOpen && (
        <aside style={{
          width: 380,
          borderLeft: '1px solid var(--anka-border)',
          background: 'var(--anka-bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          <AiAssistantApp />
        </aside>
      )}
    </div>
  );
}
