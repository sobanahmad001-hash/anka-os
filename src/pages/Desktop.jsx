export default function Desktop() {
  return (
    <div style={{
      height: '100vh', width: '100vw', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--anka-bg-primary)',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: 36, fontWeight: 700, letterSpacing: '-0.03em', marginBottom: 12,
          background: 'linear-gradient(135deg, var(--anka-accent), #a78bfa)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          Anka OS
        </div>
        <p style={{ color: 'var(--anka-text-tertiary)', fontSize: 14 }}>
          New layout coming soon
        </p>
      </div>
    </div>
  );
}
