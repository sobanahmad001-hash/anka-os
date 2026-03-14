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
    <div className="h-screen w-screen bg-[var(--anka-bg-primary)] flex flex-col overflow-hidden select-none">
      {/* Desktop area with subtle grid */}
      <div
        className="flex-1 relative"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(108,92,231,0.03) 1px, transparent 0)',
          backgroundSize: '40px 40px',
        }}
        onClick={() => showLauncher && setShowLauncher(false)}
      >
        {/* Desktop icons — quick access to apps */}
        <div className="absolute top-6 left-6 flex flex-col gap-4">
          {apps.slice(0, 6).map((app) => (
            <button
              key={app.id}
              onDoubleClick={() => openApp(app)}
              className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-white/5 transition w-20 cursor-pointer"
              title={app.name}
            >
              <span className="text-3xl">{app.icon}</span>
              <span className="text-[10px] text-[var(--anka-text-secondary)] truncate w-full text-center">
                {app.name}
              </span>
            </button>
          ))}
        </div>

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
