import { useRef, useCallback, useState } from 'react';

export default function Window({
  id,
  title,
  icon,
  component: AppComponent,
  x,
  y,
  width,
  height,
  maximized,
  zIndex,
  isActive,
  onClose,
  onMinimize,
  onMaximize,
  onFocus,
  onMove,
  onResize,
  openAppById,
}) {
  const headerRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);

  const handleMouseDown = useCallback(
    (e) => {
      if (maximized) return;
      onFocus();
      setDragging(true);

      const startX = e.clientX - x;
      const startY = e.clientY - y;

      function handleMouseMove(e) {
        onMove(e.clientX - startX, e.clientY - startY);
      }
      function handleMouseUp() {
        setDragging(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      }

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [x, y, maximized, onFocus, onMove],
  );

  const handleResizeMouseDown = useCallback(
    (e) => {
      if (maximized) return;
      e.stopPropagation();
      onFocus();

      const startX = e.clientX;
      const startY = e.clientY;
      const startW = width;
      const startH = height;

      function handleMouseMove(e) {
        const newW = Math.max(400, startW + (e.clientX - startX));
        const newH = Math.max(300, startH + (e.clientY - startY));
        onResize(newW, newH);
      }
      function handleMouseUp() {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      }

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [width, height, maximized, onFocus, onResize],
  );

  const style = maximized
    ? { top: 0, left: 0, width: '100%', height: '100%', zIndex }
    : { top: y, left: x, width, height, zIndex };

  return (
    <div
      className="absolute flex flex-col overflow-hidden anka-scale-in"
      style={{
        ...style,
        borderRadius: maximized ? 0 : 16,
        boxShadow: isActive
          ? 'var(--anka-shadow-xl), var(--anka-shadow-glow)'
          : 'var(--anka-shadow-lg)',
        border: `1px solid ${isActive ? 'var(--anka-border-accent)' : 'var(--anka-border)'}`,
        transition: dragging ? 'none' : 'box-shadow 0.3s ease, border-color 0.3s ease',
      }}
      onMouseDown={onFocus}
    >
      {/* Title bar — sleek glass effect */}
      <div
        ref={headerRef}
        onMouseDown={handleMouseDown}
        onDoubleClick={onMaximize}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className="anka-glass-heavy shrink-0"
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
          gap: 10,
          cursor: dragging ? 'grabbing' : 'grab',
          borderBottom: '1px solid var(--anka-border-subtle)',
        }}
      >
        {/* Traffic lights */}
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="group cursor-pointer"
            style={{ width: 13, height: 13, borderRadius: '50%', background: hovering || isActive ? '#ff5f57' : 'var(--anka-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }}
          >
            {hovering && <svg width="7" height="7" viewBox="0 0 7 7" fill="none"><path d="M1 1l5 5M6 1L1 6" stroke="rgba(0,0,0,0.5)" strokeWidth="1.5" strokeLinecap="round" /></svg>}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMinimize(); }}
            className="group cursor-pointer"
            style={{ width: 13, height: 13, borderRadius: '50%', background: hovering || isActive ? '#febc2e' : 'var(--anka-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }}
          >
            {hovering && <svg width="7" height="2" viewBox="0 0 7 2" fill="none"><path d="M0.5 1h6" stroke="rgba(0,0,0,0.5)" strokeWidth="1.5" strokeLinecap="round" /></svg>}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMaximize(); }}
            className="group cursor-pointer"
            style={{ width: 13, height: 13, borderRadius: '50%', background: hovering || isActive ? '#28c840' : 'var(--anka-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }}
          >
            {hovering && <svg width="7" height="7" viewBox="0 0 7 7" fill="none"><path d="M1 2.5V1h4.5M6 4.5V6H1.5" stroke="rgba(0,0,0,0.5)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>
        </div>

        {/* Title centered */}
        <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
          <span className="text-sm opacity-70">{icon}</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--anka-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </span>
        </div>

        {/* Spacer to balance traffic lights */}
        <div style={{ width: 55 }} />
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto" style={{ background: 'var(--anka-bg-primary)' }}>
        {AppComponent && <AppComponent openAppById={openAppById} />}
      </div>

      {/* Resize handle — subtle corner grip */}
      {!maximized && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute bottom-0 right-0 cursor-se-resize opacity-0 hover:opacity-40 transition-opacity"
          style={{ width: 18, height: 18 }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', bottom: 3, right: 3 }}>
            <line x1="9" y1="1" x2="1" y2="9" stroke="var(--anka-text-tertiary)" strokeWidth="1" />
            <line x1="9" y1="4" x2="4" y2="9" stroke="var(--anka-text-tertiary)" strokeWidth="1" />
            <line x1="9" y1="7" x2="7" y2="9" stroke="var(--anka-text-tertiary)" strokeWidth="1" />
          </svg>
        </div>
      )}
    </div>
  );
}
