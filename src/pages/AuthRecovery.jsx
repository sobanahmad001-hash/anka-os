import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { recoveryRedirect } from '../data/authOnboarding.js'
import './AuthOnboarding.css'

export default function AuthRecovery() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('ready')
  const busy = useRef(false)
  async function submit(event) {
    event.preventDefault()
    if (busy.current || status === 'sent') return
    busy.current = true; setStatus('sending')
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: recoveryRedirect(window.location.origin) })
      if (error) throw new Error('Not confirmed')
      setStatus('sent')
    } catch { setStatus('error') } finally { busy.current = false }
  }
  return <main className="auth-onboarding"><section aria-labelledby="recovery-title">
    <p className="auth-onboarding-brand">Anka Sphere</p><h1 id="recovery-title">Recover your account</h1>
    <p>Use the email address that received your invitation. This does not create a new account or change your workspace access.</p>
    {status === 'sent' ? <p role="status">If this address is eligible, a recovery link will arrive by email. Use the newest link to set your password.</p> : <form onSubmit={submit}>
      <label htmlFor="recovery-email">Email</label><input id="recovery-email" type="email" autoComplete="email" required value={email} disabled={status === 'sending'} onChange={event => setEmail(event.target.value)} />
      <button disabled={status === 'sending'}>{status === 'sending' ? 'Requesting…' : 'Send recovery link'}</button>
    </form>}
    {status === 'error' && <p role="alert">The request could not be confirmed. Check your inbox before trying again later.</p>}
    <nav aria-label="Account help"><Link to="/login">Back to sign in</Link></nav>
  </section></main>
}
