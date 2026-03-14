export default function AppLauncher({ apps, onOpenApp, onClose }) {
  return (
    <div
      className="absolute bottom-16 left-3 w-80 bg-[var(--anka-bg-secondary)]/95 backdrop-blur-xl border border-[var(--anka-border)] rounded-2xl p-4 shadow-2xl z-[9998]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--anka-text-secondary)] uppercase tracking-wider">
          Applications
        </h3>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {apps.map((app) => (
          <button
            key={app.id}
            onClick={() => {
              onOpenApp(app);
              onClose();
            }}
            className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-[var(--anka-bg-tertiary)] transition cursor-pointer"
          >
            <span className="text-2xl">{app.icon}</span>
            <span className="text-[11px] text-[var(--anka-text-secondary)] truncate w-full text-center">
              {app.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
