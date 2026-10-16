const canonical = 'https://anka-os.vercel.app'
export function recoveryRedirect(origin) {
  const url = new URL(origin)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol)
  if (url.origin !== canonical && !local) throw new Error('Use the production sign-in page to recover your account.')
  return new URL('/auth/callback', url.origin).href
}

export async function verifiedOnboardingUser(auth) {
  // Wait for the SDK to consume the email callback before validating with Auth.
  const session = await auth.getSession()
  if (session.error || !session.data?.session) throw new Error('A fresh invitation or recovery link is required.')
  const result = await auth.getUser()
  if (result.error || !result.data?.user) throw new Error('A fresh invitation or recovery link is required.')
  return result.data.user
}

export async function saveOnboardingPassword(auth, userId, password, confirmation) {
  if (password.length < 8 || password !== confirmation) throw new Error('Use at least 8 characters and enter the same password twice.')
  const user = await verifiedOnboardingUser(auth)
  if (user.id !== userId) throw new Error('The signed-in account changed. Open a fresh recovery link.')
  const result = await auth.updateUser({ password })
  if (result.error || result.data?.user?.id !== userId) throw new Error('Password update was not confirmed. Try signing in, or request a fresh recovery link. Your password must meet the account security requirements.')
}
