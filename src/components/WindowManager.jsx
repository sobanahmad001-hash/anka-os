import Window from './Window.jsx';

export default function WindowManager({
  windows,
  activeWindowId,
  onClose,
  onMinimize,
  onMaximize,
  onFocus,
  onMove,
  onResize,
  openAppById,
}) {
  return (
    <>
      {windows.map(
        (w) =>
          !w.minimized && (
            <Window
              key={w.id}
              {...w}
              isActive={w.id === activeWindowId}
              onClose={() => onClose(w.id)}
              onMinimize={() => onMinimize(w.id)}
              onMaximize={() => onMaximize(w.id)}
              onFocus={() => onFocus(w.id)}
              onMove={(x, y) => onMove(w.id, x, y)}
              onResize={(width, height) => onResize(w.id, width, height)}
              openAppById={openAppById}
            />
          ),
      )}
    </>
  );
}
