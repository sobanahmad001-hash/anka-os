// Never derive an email destination from an untrusted request Origin.
export const CANONICAL_APP_URL = 'https://anka-os.vercel.app'
const loopback = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
export function invitationRedirect(configured = '', backend = ''): string {
  const app = new URL(configured || CANONICAL_APP_URL)
  if (app.username || app.password || app.search || app.hash || app.pathname !== '/') throw new Error('Invalid app origin')
  if (app.origin !== CANONICAL_APP_URL) {
    const api = new URL(backend)
    if (!loopback(app) || !loopback(api) || !['http:', 'https:'].includes(app.protocol) || !['http:', 'https:'].includes(api.protocol)) throw new Error('Invalid app origin')
  }
  return new URL('/auth/callback', app).toString()
}
