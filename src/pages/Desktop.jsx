import { useState, useCallback, useEffect } from 'react';
import Taskbar from '../components/Taskbar.jsx';
import WindowManager from '../components/WindowManager.jsx';
import AppLauncher from '../components/AppLauncher.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { getDepartmentApps } from '../config/apps.js';

export default function Desktop() {
  const { profile } = useAuth();
  const [windows, setWindows] = useState([]);
  const [showLauncher, setShowLauncher] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [activeWindowId, setActiveWindowId] = useState(null);
  const [nextZIndex, setNextZIndex] = useState(10);

  const department = profile?.department || 'development';
  const role = profile?.role || 'intern';
  const apps = getDepartmentApps(department, role);

  // Cmd+K / Ctrl+K global search shortcut
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch((s) => !s);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Open app by id (used by global search)
  const openAppById = useCallback((appId) => {
    const app = apps.find((a) => a.id === appId);
    if (app) openApp(app);
  }, [apps]);

  const openApp = useCallback(
    (app) => {
      // If already open, focus it
      const existing = windows.find((w) => w.appId === app.id);
      if (existing) {
        setActiveWindowId(existing.id);
        setWindows((prev) =>
          prev.map((w) =>
            w.id === existing.id
              ? { ...w, zIndex: nextZIndex, minimized: false }
              : w,
          ),
        );
        setNextZIndex((z) => z + 1);
        return;
      }

      const id = `${app.id}-${Date.now()}`;
      setWindows((prev) => [
        ...prev,
        {
          id,
          appId: app.id,
          title: app.name,
          icon: app.icon,
          component: app.component,
          x: 80 + (prev.length % 6) * 40,
          y: 40 + (prev.length % 6) * 30,
          width: app.defaultWidth || 800,
          height: app.defaultHeight || 550,
          minimized: false,
          maximized: false,
          zIndex: nextZIndex,
        },
      ]);
      setActiveWindowId(id);
      setNextZIndex((z) => z + 1);
      setShowLauncher(false);
    },
    [windows, nextZIndex],
  );

  const closeWindow = useCallback((id) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
    setActiveWindowId(null);
  }, []);

  const minimizeWindow = useCallback((id) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
    );
  }, []);

  const maximizeWindow = useCallback((id) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, maximized: !w.maximized } : w,
      ),
    );
  }, []);

  const focusWindow = useCallback(
    (id) => {
      setActiveWindowId(id);
      setWindows((prev) =>
        prev.map((w) =>
          w.id === id ? { ...w, zIndex: nextZIndex, minimized: false } : w,
        ),
      );
      setNextZIndex((z) => z + 1);
    },
    [nextZIndex],
  );

  const updateWindowPosition = useCallback((id, x, y) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, x, y } : w)),
    );
  }, []);

  const updateWindowSize = useCallback((id, width, height) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, width, height } : w)),
    );
  }, []);

  return (
    <div style={{
      height: '100vh', width: '100vw', background: 'var(--anka-bg-primary)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', userSelect: 'none',
    }}>
      {/* Desktop area */}
      <div
        className="flex-1 relative"
        style={{ position: 'relative' }}
        onClick={() => showLauncher && setShowLauncher(false)}
      >
        {/* Ambient background — soft gradient mesh */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', top: '5%', right: '10%', width: 400, height: 400, borderRadius: '50%',
            background: 'radial-gradient(circle, var(--anka-accent-soft) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }} />
          <div style={{
            position: 'absolute', bottom: '10%', left: '5%', width: 300, height: 300, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(167, 139, 250, 0.04) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }} />
          {/* Subtle dot grid */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'radial-gradient(circle at 1px 1px, var(--anka-border-subtle) 1px, transparent 0)',
            backgroundSize: '48px 48px',
          }} />
        </div>

        {/* Desktop icons — refined with hover effect */}
        <div style={{ position: 'absolute', top: 24, left: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {apps.slice(0, 8).map((app) => (
            <button
              key={app.id}
              onDoubleClick={() => openApp(app)}
              className="cursor-pointer"
              title={app.name}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                padding: '10px 8px', borderRadius: 12, width: 76, background: 'transparent',
                border: 'none', color: 'inherit', transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--anka-bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 28, lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' }}>{app.icon}</span>
              <span style={{
                fontSize: 10, fontWeight: 500, color: 'var(--anka-text-secondary)',
                width: '100%', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }}>
                {app.name}
              </span>
            </button>
          ))}
        </div>

        {/* Cmd+K hint */}
        {windows.length === 0 && !showLauncher && !showSearch && (
          <div className="anka-fade-in" style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            textAlign: 'center', pointerEvents: 'none',
          }}>
            <p style={{ fontSize: 14, color: 'var(--anka-text-tertiary)', marginBottom: 12 }}>
              Press <kbd style={{
                padding: '3px 8px', borderRadius: 6, background: 'var(--anka-bg-surface)',
                border: '1px solid var(--anka-border)', fontSize: 12, color: 'var(--anka-text-secondary)',
              }}>⌘K</kbd> to search or double-click an app to get started
            </p>
          </div>
        )}

        {/* Windows */}
        <WindowManager
          windows={windows}
          activeWindowId={activeWindowId}
          onClose={closeWindow}
          onMinimize={minimizeWindow}
          onMaximize={maximizeWindow}
          onFocus={focusWindow}
          onMove={updateWindowPosition}
          onResize={updateWindowSize}
          openAppById={openAppById}
        />

        {/* App Launcher overlay */}
        {showLauncher && (
          <AppLauncher
            apps={apps}
            onOpenApp={openApp}
            onClose={() => setShowLauncher(false)}
          />
        )}

        {/* Global Search overlay */}
        {showSearch && (
          <GlobalSearch
            onClose={() => setShowSearch(false)}
            onOpenApp={openAppById}
          />
        )}
      </div>

      {/* Taskbar */}
      <Taskbar
        windows={windows}
        activeWindowId={activeWindowId}
        onFocus={focusWindow}
        onToggleLauncher={() => setShowLauncher((s) => !s)}
        showLauncher={showLauncher}
      />
    </div>
  );
}
