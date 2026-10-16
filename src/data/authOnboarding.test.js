import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { recoveryRedirect, verifiedOnboardingUser, saveOnboardingPassword } from './authOnboarding.js'
const user = { id: 'synthetic-user' }
const auth = overrides => ({getSession:async()=>({data:{session:{user}}}),getUser:async()=>({data:{user}}),updateUser:async()=>({data:{user}}),...overrides})
test('recovery uses exact callback on canonical and local development origins only', () => {
 assert.equal(recoveryRedirect('https://anka-os.vercel.app'), 'https://anka-os.vercel.app/auth/callback')
 assert.equal(recoveryRedirect('http://localhost:5173'), 'http://localhost:5173/auth/callback')
 for (const origin of ['https://evil.test','http://anka-os.vercel.app','https://anka-os.vercel.app.evil.test']) assert.throws(()=>recoveryRedirect(origin))
})
test('onboarding waits for SDK callback and verifies with Auth rather than trusting URL claims', async () => {
 const calls=[]
 assert.deepEqual(await verifiedOnboardingUser(auth({getSession:async()=>{calls.push('session');return{data:{session:{user}}}},getUser:async()=>{calls.push('verified');return{data:{user}}}})),user)
 assert.deepEqual(calls,['session','verified'])
 for (const client of [auth({getSession:async()=>({data:{session:null}})}),auth({getUser:async()=>({error:{message:'private'}})})]) await assert.rejects(verifiedOnboardingUser(client),/fresh invitation/)
})
test('password update rejects invalid confirmation and changed account before writes', async () => {
 let writes=0
 const client=auth({updateUser:async()=>{writes++;return{data:{user}}}})
 await assert.rejects(saveOnboardingPassword(client,user.id,'short','short'))
 await assert.rejects(saveOnboardingPassword(client,user.id,'long-password','different'))
 await assert.rejects(saveOnboardingPassword(client,'other','long-password','long-password'),/account changed/)
 assert.equal(writes,0)
 await saveOnboardingPassword(client,user.id,'long-password','long-password'); assert.equal(writes,1)
})
test('uncertain or rejected password update never retries or exposes raw service errors', async () => {
 let writes=0
 await assert.rejects(saveOnboardingPassword(auth({updateUser:async()=>{writes++;return{error:{message:'secret'}}}}),user.id,'long-password','long-password'),error=>!error.message.includes('secret'))
 assert.equal(writes,1)
 await assert.rejects(saveOnboardingPassword(auth({updateUser:async()=>({data:{user:{id:'other'}}})}),user.id,'long-password','long-password'))
})
test('callback and recovery are public routes, recovery never creates users or grants', () => {
 const app=readFileSync(new URL('../App.jsx',import.meta.url),'utf8')
 assert.match(app, /path="\/auth\/callback" element={<AuthCallback/)
 assert.match(app, /path="\/auth\/recover" element={<AuthRecovery/)
 const page=readFileSync(new URL('../pages/AuthRecovery.jsx',import.meta.url),'utf8')
 assert.match(page,/resetPasswordForEmail/); assert.doesNotMatch(page,/signUp|inviteUserByEmail|from\(/)
})
