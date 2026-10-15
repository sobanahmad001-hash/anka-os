import test from 'node:test'
import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
import { buildPeopleAccessReadModel } from './peopleAccessReadModel.js'
const descendants=n=>[n,...n.childNodes.flatMap(descendants)]
const props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {resolve,promise}}
function model(org,user,status='active') {return buildPeopleAccessReadModel({organization_id:org,members:[{user_id:user,name:org+' person'}],projects:[],snapshot:{organization_id:org,user_id:user,legacy_role:'contributor',legacy_department_id:'content',status,department_memberships:[],contributor_designations:[],project_manager_bindings:[]}},{state:'available',full_name:org+' person',role:'admin',department:'design'},'2026-10-15')}
test('profile clears org/target state, aborts old reads, ignores late responses and requires explicit scoped history',async t=>{
  const env=mountedEnvironment(),before={};for(const [key,value] of Object.entries({document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){before[key]=globalThis[key];globalThis[key]=value}
  const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'}),root=createRoot(env.container)
  t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,before)})
  const {default:Panel}=await vite.ssrLoadModule('/src/components/PeopleAccessProfile.jsx')
  const pending=defer(),calls=[];let oldSignal
  const repository={async list(org,{signal}){calls.push('list:'+org);if(org==='empty')return [];if(org==='error')throw Error('Synthetic read denied');return [{id:'target',name:org+' person',status:'active'}]},async read(org,user,{signal}){calls.push('read:'+org);if(org==='A'){oldSignal=signal;return pending.promise}return model(org,user,'revoked')},async history(org,user){calls.push('history:'+org);return []}}
  const render=org=>act(async()=>root.render(createElement(Panel,{organizationId:org,organizationName:'Org '+org,repository})))
  const named=name=>descendants(env.container).find(n=>props(n)?.['aria-label']===name)
  const select=()=>act(async()=>props(named('People access team member')).onChange({target:{value:'target'}}))
  await render('A');await select();assert.match(env.container.textContent,/Loading people/)
  await render('B');assert(oldSignal.aborted);assert(!env.container.textContent.includes('A person'));assert.equal(named('Identity and organization access'),undefined)
  await act(async()=>pending.resolve(model('A','target')));assert.equal(named('Identity and organization access'),undefined)
  await select();assert.match(env.container.textContent,/revoked/);assert.match(env.container.textContent,/global profile role does not match/);assert.match(env.container.textContent,/Not evaluated/)
  assert(!calls.some(x=>x.startsWith('history:')))
  const button=descendants(env.container).find(n=>n.tagName==='BUTTON'&&n.textContent==='Read retained deactivation history')
  assert.equal(props(button).type,'button');await act(async()=>props(button).onClick());assert.match(env.container.textContent,/No previous deactivations/);assert(calls.includes('history:B'))
  await render('empty');assert.match(env.container.textContent,/No team members available/);assert.equal(named('Identity and organization access'),undefined)
  await render('error');assert.match(env.container.textContent,/Synthetic read denied/);assert.equal(named('Identity and organization access'),undefined)
})

test('signal abort clears loaded profile/history without host render; aborts pending reads and retry/unmount boundaries',async t=>{
  const env=mountedEnvironment(),before={};for(const [key,value] of Object.entries({document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){before[key]=globalThis[key];globalThis[key]=value}
  const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'}),root=createRoot(env.container)
  t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,before)})
  const {default:Panel}=await vite.ssrLoadModule('/src/components/PeopleAccessProfile.jsx')
  const calls=[];let pendingRead=null,pendingHistory=null,readSignal,historySignal
  const repository={async list(org,{signal}){calls.push('list');signal.throwIfAborted();return [{id:'person',name:'Synthetic',status:'active'}]},async read(org,user,{signal}){calls.push('read');readSignal=signal;return pendingRead?pendingRead.promise:model(org,user)},async history(org,user,{signal}){calls.push('history');historySignal=signal;return pendingHistory?pendingHistory.promise:[{id:'retained',occurredAt:'Retained date',reassignmentCount:2}]}}
  const named=name=>descendants(env.container).find(n=>props(n)?.['aria-label']===name)
  const button=text=>descendants(env.container).find(n=>n.tagName==='BUTTON'&&n.textContent===text)
  const render=signal=>act(async()=>root.render(createElement(Panel,{organizationId:'org',repository,requestSignal:signal})))
  const select=()=>act(async()=>props(named('People access team member')).onChange({target:{value:'person'}}))
  const a=new AbortController();await render(a.signal);await select();await act(async()=>props(button('Read retained deactivation history')).onClick())
  assert.match(env.container.textContent,/Retained date/);assert(named('Identity and organization access'))
  await act(async()=>a.abort()) // Crucially no root.render / host state update.
  assert.equal(named('Identity and organization access'),undefined);assert.equal(named('Retained access history'),undefined);assert(!env.container.textContent.includes('Retained date'));assert.equal(named('People access team member').disabled,true);assert.equal(button('Refresh').disabled,true)
  const count=calls.length;await act(async()=>props(button('Refresh')).onClick());assert.equal(calls.length,count)
  await render(a.signal);assert.equal(calls.length,count) // same aborted-signal retry cannot read
  const b=new AbortController();await render(b.signal);assert.equal(named('Identity and organization access'),undefined);await select();assert(named('Identity and organization access'))
  pendingHistory=defer();await act(async()=>{props(button('Read retained deactivation history')).onClick()});await act(async()=>b.abort());assert(historySignal.aborted)
  await act(async()=>pendingHistory.resolve([{id:'late',occurredAt:'LATE HISTORY',reassignmentCount:8}]));assert(!env.container.textContent.includes('LATE HISTORY'));assert.equal(named('Identity and organization access'),undefined)
  pendingHistory=null;pendingRead=defer();const c=new AbortController();await render(c.signal);await select();await act(async()=>c.abort());assert(readSignal.aborted)
  await act(async()=>pendingRead.resolve(model('org','person')));assert.equal(named('Identity and organization access'),undefined)
  pendingRead=defer();const d=new AbortController();await render(d.signal);await select();const old=readSignal;const e=new AbortController();await render(e.signal);assert(old.aborted);assert.equal(named('Identity and organization access'),undefined)
  await act(async()=>pendingRead.resolve(model('org','person')));await act(async()=>root.unmount());assert(readSignal.aborted)
})
