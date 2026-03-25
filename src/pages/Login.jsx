import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const inputStyle = {
  width: '100%',
  padding: '12px 16px',
  borderRadius: 12,
  border: '1px solid var(--anka-border)',
  background: 'var(--anka-bg-surface)',
  color: 'var(--anka-text-primary)',
  fontSize: 14,
  outline: 'none',
  transition: 'all 0.2s ease',
};

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      await signIn(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      height: '100vh', width: '100vw', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--anka-bg-primary)', position: 'relative', overflow: 'hidden',
    }}>
      {/* Ambient gradient orbs */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: '-20%', left: '-10%', width: 600, height: 600, borderRadius: '50%',
          background: 'radial-gradient(circle, var(--anka-accent-glow) 0%, transparent 70%)',
          filter: 'blur(80px)', opacity: 0.6, animation: 'anka-float 8s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', bottom: '-20%', right: '-10%', width: 500, height: 500, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(167, 139, 250, 0.15) 0%, transparent 70%)',
          filter: 'blur(80px)', opacity: 0.5, animation: 'anka-float 10s ease-in-out infinite reverse',
        }} />
        <div style={{
          position: 'absolute', top: '40%', right: '20%', width: 300, height: 300, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(96, 165, 250, 0.08) 0%, transparent 70%)',
          filter: 'blur(60px)', animation: 'anka-float 12s ease-in-out infinite',
        }} />
      </div>

      <div className="anka-fade-in" style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420, margin: '0 24px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{
            fontSize: 42, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1,
            background: 'linear-gradient(135deg, var(--anka-accent), #a78bfa, #60a5fa)',
            backgroundSize: '200% 200%', animation: 'anka-gradient-flow 6s ease infinite',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            Anka OS
          </h1>
          <p style={{ color: 'var(--anka-text-tertiary)', marginTop: 8, fontSize: 14, fontWeight: 400 }}>
            Your creative workspace, reimagined
          </p>
        </div>

        {/* Card */}
        <div className="anka-glass-heavy" style={{
          borderRadius: 20, padding: 36, border: '1px solid var(--anka-border)',
          boxShadow: 'var(--anka-shadow-xl), var(--anka-shadow-glow)',
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 28, letterSpacing: '-0.02em' }}>
            Welcome back
          </h2>

          {error && (
            <div style={{
              marginBottom: 20, padding: '12px 16px', borderRadius: 12,
              background: 'var(--anka-danger-muted)', border: '1px solid rgba(248, 113, 113, 0.2)',
              color: 'var(--anka-danger)', fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--anka-text-secondary)', marginBottom: 6, fontWeight: 500 }}>
                Email
              </label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                style={inputStyle} placeholder="you@ankastudio.com"
                onFocus={(e) => { e.target.style.borderColor = 'var(--anka-accent)'; e.target.style.boxShadow = '0 0 0 3px var(--anka-accent-soft)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--anka-border)'; e.target.style.boxShadow = 'none'; }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--anka-text-secondary)', marginBottom: 6, fontWeight: 500 }}>
                Password
              </label>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
                style={inputStyle} placeholder="••••••••"
                onFocus={(e) => { e.target.style.borderColor = 'var(--anka-accent)'; e.target.style.boxShadow = '0 0 0 3px var(--anka-accent-soft)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--anka-border)'; e.target.style.boxShadow = 'none'; }}
              />
            </div>

            <button
              type="submit" disabled={loading} className="cursor-pointer"
              style={{
                width: '100%', padding: '13px 0', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, var(--anka-accent), #a78bfa)',
                color: 'white', fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em',
                cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
                transition: 'all 0.2s ease',
                boxShadow: '0 4px 16px var(--anka-accent-glow)',
              }}
              onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 24px var(--anka-accent-glow)'; } }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 16px var(--anka-accent-glow)'; }}
            >
              {loading ? 'Please wait...' : 'Sign In'}
            </button>
          </form>


        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--anka-text-tertiary)', marginTop: 32 }}>
          © 2026 Anka Studio. All rights reserved.
        </p>
      </div>
    </div>
  );
}
