import { invitationRedirect } from './invitationRedirect.ts'
const assert = (value: unknown) => { if (!value) throw new Error('Assertion failed') }
Deno.test('production invite destination is canonical without any caller origin', () => {
 assert(invitationRedirect() === 'https://anka-os.vercel.app/auth/callback')
 assert(invitationRedirect('https://anka-os.vercel.app', 'https://example.supabase.co') === 'https://anka-os.vercel.app/auth/callback')
})
Deno.test('local redirects require both a local app and a local backend', () => {
 assert(invitationRedirect('http://localhost:5173', 'http://127.0.0.1:54321') === 'http://localhost:5173/auth/callback')
 for (const app of ['http://localhost:3000', 'https://evil.test', 'https://anka-os.vercel.app.evil.test', 'https://anka-os.vercel.app@evil.test', 'https://anka-os.vercel.app/?next=evil', 'https://anka-os.vercel.app/#secret', 'https://anka-os.vercel.app/path', 'http://anka-os.vercel.app']) {
   let rejected = false; try { invitationRedirect(app, 'https://production.supabase.co') } catch { rejected = true }; assert(rejected)
 }
})
