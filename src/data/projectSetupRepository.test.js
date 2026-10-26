import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transformSync} from 'esbuild'
import {createRequire} from 'node:module'
import * as protocol from './projectSetup.js'
import {SERVICE_CATALOGUE} from './serviceCatalogue.js'
const require=createRequire(import.meta.url),module={exports:{}}
const compiled=transformSync(readFileSync(new URL('./projectSetupRepository.js',import.meta.url),'utf8'),{loader:'js',format:'cjs'}).code
new Function('require','module','exports',compiled)(name=>name.includes('/supabase')?{supabase:{}}:name.includes('projectSetup.js')?protocol:require(name),module,module.exports)
const create=module.exports.createProjectSetupRepository,id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const snapshot={organization_id:id(1),project_id:id(2),token:'a'.repeat(32),leaves:SERVICE_CATALOGUE,scopes:[],catalog:[]}
const proposal={items:[{...protocol.defaultSetupItem(SERVICE_CATALOGUE[0]),quantity:1}],pipelines:[],questions:[],explanation:'Confirmed manual selection'}
test('Chat and manual submit one validated atomic command with no separate per-service writes',async()=>{const calls=[],repo=create({rpc:async(name,args)=>{calls.push({name,args});return {data:{organization_id:id(1),project_id:id(2),request_id:id(3),revision:1,results:[]}}}});await repo.apply(snapshot,proposal,id(3),[]);assert.equal(calls.length,1);assert.equal(calls[0].name,'apply_project_setup');assert.equal(calls[0].args.p_plan.items[0].unit,SERVICE_CATALOGUE[0].unit);assert.equal(calls[0].args.p_plan.items[0].owner_id,undefined);assert.equal(calls[0].args.p_expected_token,snapshot.token)})
test('unresolved proposal never sends a command; missing secure ID is denied',async()=>{let calls=0;const repo=create({rpc:async()=>{calls++}});await assert.rejects(repo.apply(snapshot,{...proposal,questions:['How many?']},id(3),[]));await assert.rejects(repo.apply(snapshot,proposal,'',[]));assert.equal(calls,0)})
test('same original request ID and payload are retained through uncertain transport retry',async()=>{const calls=[],repo=create({rpc:async(name,args)=>{calls.push({name,args});if(calls.length===1)throw Error('Lost response');return {data:{organization_id:id(1),project_id:id(2),request_id:id(3),revision:1,results:[]}}}});await assert.rejects(repo.apply(snapshot,proposal,id(3),[]),/Lost/);await repo.apply(snapshot,proposal,id(3),[]);assert.deepEqual(calls[0],calls[1])})
test('authority and concurrent revision failures remain visible and cannot become success',async()=>{for(const [code,status] of [['42501',403],['40001',409]]){const repo=create({rpc:async()=>({error:{code,message:'Changed'}})});await assert.rejects(repo.apply(snapshot,proposal,id(3),[]),e=>e.status===status)}})
test('foreign read and mutation results are rejected',async()=>{const repo=create({rpc:async()=>({data:{...snapshot,project_id:id(9),request_id:id(3),results:[]}})});await assert.rejects(repo.snapshot(id(1),id(2)),/context/);await assert.rejects(repo.apply(snapshot,proposal,id(3),[]),/identity/)})
