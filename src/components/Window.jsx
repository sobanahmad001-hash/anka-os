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
}) {
  const headerRef = useRef(null);
  const [dragging, setDragging] = useState(false);

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
      className={`absolute flex flex-col rounded-xl overflow-hidden border transition-shadow ${
        isActive
          ? 'border-[var(--anka-accent)]/40 shadow-2xl shadow-[var(--anka-accent)]/10'
          : 'border-[var(--anka-border)] shadow-lg'
      }`}
      style={style}
      onMouseDown={onFocus}
    >
      {/* Title bar */}
      <div
        ref={headerRef}
        onMouseDown={handleMouseDown}
        onDoubleClick={onMaximize}
        className={`h-10 flex items-center px-3 gap-2 shrink-0 ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        } ${
          isActive
            ? 'bg-[var(--anka-bg-secondary)]'
            : 'bg-[var(--anka-bg-secondary)]/80'
        }`}
      >
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-medium flex-1 truncate text-[var(--anka-text-secondary)]">
          {title}
        </span>

        {/* Window controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMinimize();
            }}
            className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-400 transition cursor-pointer"
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMaximize();
            }}
            className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-400 transition cursor-pointer"
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition cursor-pointer"
          />
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 bg-[var(--anka-bg-primary)] overflow-auto">
        {AppComponent && <AppComponent />}
      </div>

      {/* Resize handle */}
      {!maximized && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        />
      )}
    </div>
  );
}
