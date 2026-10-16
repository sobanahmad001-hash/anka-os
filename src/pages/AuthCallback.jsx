import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { saveOnboardingPassword, verifiedOnboardingUser } from '../data/authOnboarding.js'
import './AuthOnboarding.css'

export default function AuthCallback() {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const busy = useRef(false)
  useEffect(() => {
    let alive = true
    verifiedOnboardingUser(supabase.auth).then(value => {
      if (alive) { setUser(value); setStatus('ready') }
    }).catch(() => {
      if (alive) { setStatus('invalid'); setError('This link is expired, already used, or could not be verified. Request a fresh recovery link below.') }
    }).finally(() => {
      // Remove callback credentials only after the SDK has finished consuming them.
      window.history.replaceState(window.history.state, '', '/auth/callback')
    })
    return () => { alive = false }
  }, [])
  async function submit(event) {
    event.preventDefault()
    if (busy.current || !user || status !== 'ready') return
    busy.current = true; setStatus('saving'); setError('')
    try {
      await saveOnboardingPassword(supabase.auth, user.id, password, confirmation)
      setPassword(''); setConfirmation(''); setStatus('saved')
    } catch (failure) {
      setError(failure.message.startsWith('Use at least') ? failure.message : 'Password update was not confirmed. Try signing in, or request a fresh recovery link. Check that your password meets the account security requirements.')
      setStatus('ready')
    } finally { busy.current = false }
  }
  return <main className="auth-onboarding"><section aria-labelledby="onboarding-title">
    <p className="auth-onboarding-brand">Anka Sphere</p>
    <h1 id="onboarding-title">Set your password</h1>
    {status === 'loading' && <p role="status">Checking your sign-in link…</p>}
    {error && <p role="alert">{error}</p>}
    {user && status !== 'saved' && <form onSubmit={submit}>
      <p>Choose a password for {user.email || 'your account'}.</p>
      <label htmlFor="new-password">New password</label>
      <input id="new-password" type="password" autoComplete="new-password" minLength={8} required value={password} disabled={status === 'saving'} onChange={event => setPassword(event.target.value)} />
      <label htmlFor="confirm-password">Confirm password</label>
      <input id="confirm-password" type="password" autoComplete="new-password" minLength={8} required value={confirmation} disabled={status === 'saving'} onChange={event => setConfirmation(event.target.value)} />
      <button disabled={status === 'saving'}>{status === 'saving' ? 'Saving…' : 'Save password'}</button>
    </form>}
    {status === 'saved' && <><p role="status">Password saved. You can now open your workspace.</p><Link to="/">Continue to workspace</Link></>}
    {status !== 'saving' && status !== 'loading' && <nav aria-label="Account help"><Link to="/auth/recover">Request a fresh recovery link</Link><Link to="/login">Back to sign in</Link></nav>}
  </section></main>
}
