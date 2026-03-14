import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const DEPARTMENTS = ['design', 'development', 'marketing'];

export default function Login() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('development');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (isRegister) {
        await signUp(email, password, fullName, department);
        setSuccess('Account created! Check your email to confirm, then sign in.');
        setIsRegister(false);
      } else {
        await signIn(email, password);
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[var(--anka-bg-primary)]">
      {/* Background gradient blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-[var(--anka-accent)] opacity-10 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-purple-500 opacity-10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-[var(--anka-accent)] to-purple-400 bg-clip-text text-transparent">
            Anka OS
          </h1>
          <p className="text-[var(--anka-text-secondary)] mt-2 text-sm">
            Anka Studio Workspace
          </p>
        </div>

        {/* Card */}
        <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-2xl p-8 shadow-2xl">
          <h2 className="text-xl font-semibold mb-6">
            {isRegister ? 'Create Account' : 'Welcome Back'}
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <>
                <div>
                  <label className="block text-sm text-[var(--anka-text-secondary)] mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)] focus:outline-none focus:border-[var(--anka-accent)] transition"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[var(--anka-text-secondary)] mb-1">
                    Department
                  </label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-4 py-3 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)] transition"
                  >
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d.charAt(0).toUpperCase() + d.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div>
              <label className="block text-sm text-[var(--anka-text-secondary)] mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)] focus:outline-none focus:border-[var(--anka-accent)] transition"
                placeholder="you@ankastudio.com"
              />
            </div>

            <div>
              <label className="block text-sm text-[var(--anka-text-secondary)] mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-3 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)] focus:outline-none focus:border-[var(--anka-accent)] transition"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white font-medium rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading
                ? 'Please wait...'
                : isRegister
                  ? 'Create Account'
                  : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsRegister(!isRegister);
                setError('');
                setSuccess('');
              }}
              className="text-sm text-[var(--anka-accent)] hover:text-[var(--anka-accent-hover)] transition cursor-pointer"
            >
              {isRegister
                ? 'Already have an account? Sign In'
                : "Don't have an account? Register"}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--anka-text-secondary)] mt-6">
          © 2026 Anka Studio. All rights reserved.
        </p>
      </div>
    </div>
  );
}
