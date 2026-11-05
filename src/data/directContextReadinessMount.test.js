import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
import { actor, organizationId, createDirectChatFixture, allowlist } from '../../tools/direct-chat-fixture.js'

const descendants = node => [node, ...node.childNodes.flatMap(descendants)]
const props = node => node?.[Object.keys(node).find(key => key.startsWith('__reactProps$'))]

const defer = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

test('New Project Chat missing model never exposes allowance controls',async t=>{
 let calls=0;const ui=await mount(t,{surface:'project',role:'system_owner',allowlist:{connections:[]},allowanceRpc:async()=>{calls++;throw Error('unexpected')}});
 await ui.click('Chat settings');await flush();assert.equal(ui.button('Preview allowance'),undefined);
 assert.equal(ui.button('Review Project Chat allowance'),undefined);assert.equal(calls,0);
 assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0});
});

test('New Project Chat switching projects ignores an old available response and keeps each draft scoped',async t=>{
 const project='a0000000-0000-4000-8000-000000000077',late=defer(),requests=[];
 const ui=await mount(t,{surface:'project',role:'system_owner',readiness:async input=>{
  requests.push(input);if(input.project_id!==project)return late.promise;
  return {paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured',spend_readiness_status:'prior_cycle_reconciliation_required',prospective_allowance_status:'inactive'};
 },allowanceRpc:async()=>({data:{status:'none'}})});
 await ui.type('Original project draft');await ui.render({projectId:project});await flush();
 late.resolve({paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured',spend_readiness_status:'ready',prospective_allowance_status:'available'});await flush();
 assert.equal(requests.at(-1).project_id,project);assert.equal(ui.named('Message').value,'');
 assert.ok(ui.button('Review Project Chat allowance'));assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0});
 await ui.render();await flush();assert.equal(ui.named('Message').value,'Original project draft');
});


async function mount(t, options = {}) {
  const environment = mountedEnvironment(), storage = new Map()
  const values = { document: environment.document, window: environment.window, Event: environment.window.Event,
    Node: environment.window.Node, HTMLElement: environment.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, values)
  const fixture = createDirectChatFixture(options)
  const scope = { contextKind: fixture.scope.context_kind, projectId: fixture.scope.project_id || '', departmentId: fixture.scope.department_id || '' }
  const accessError = () => {}
  const scopeController = new AbortController()
  globalThis.__directChatTest = { fixture, actor, allowlist: options.allowlist || allowlist, allowanceRpc: options.allowanceRpc, organization: { activeMembership: {role:options.role || 'member'}, activeOrganizationId: organizationId, scopeRevision: 1, requestSignal: scopeController.signal, handleOrganizationAccessError: accessError } }
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [{
    name: 'direct-chat-mounted-offline', enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('/lib/supabase.js')) return '\0direct-import-client'
      if (source.endsWith('AuthContext.jsx')) return '\0direct-auth'
      if (source.endsWith('OrganizationContext.jsx')) return '\0direct-org'
      if (source.endsWith('departmentChatRepository.js')) return '\0direct-chat'
      if (source.endsWith('contextChatRunnerRepository.js')) return '\0direct-runner'
      if (source.endsWith('integrationRepository.js')) return '\0direct-integrations'
      if (source.endsWith('PrivateDesignVideoTools.jsx')) return '\0direct-video'
    },
    load(id) {
      if (id === '\0direct-import-client') return 'export const supabase = {rpc:(...args)=>globalThis.__directChatTest.allowanceRpc(...args),functions:{invoke(){throw Error("Unexpected importer network request")}}}'
      if (id === '\0direct-auth') return 'export const useAuth = () => ({ user: { id: globalThis.__directChatTest.actor } })'
      if (id === '\0direct-org') return 'export const useOrganization = () => globalThis.__directChatTest.organization'
      if (id === '\0direct-chat') return 'export const departmentChat = new Proxy({}, {get: (_, key) => (...args) => globalThis.__directChatTest.fixture.chat[key](...args)})'
      if (id === '\0direct-runner') return 'export const contextChatRunner = new Proxy({}, {get: (_, key) => (...args) => globalThis.__directChatTest.fixture.runner[key](...args)})'
      if (id === '\0direct-integrations') return 'export const integrations = { listModelAllowlist: async () => globalThis.__directChatTest.allowlist }'
      if (id === '\0direct-video') return `import {createElement} from 'react'; export default function VideoBridgeProbe(props){globalThis.__directChatTest.video = props; return createElement('span',null,'Offline video bridge probe')}`
    },
  }] })
  const { default: Panel } = await vite.ssrLoadModule('/src/components/ContextConversationPanel.jsx')
  const root = createRoot(environment.container)
  let key = 1
  const render = async (overrides = {}) => { await act(async () => root.render(createElement(Panel, { key, directSend: true, onNavigationBusyChange: options.onNavigationBusyChange, ...scope, ...overrides }))); await flush() }
  if (options.readiness) fixture.chat.getContextChatReadiness = options.readiness
  if (options.read) fixture.chat.getContextConversation = options.read
  await render(options.initial ? { initialConversation: fixture.data.rows[0] } : {})
  t.after(async () => { await act(async () => root.unmount()); await vite.close(); Object.assign(globalThis, previous); delete globalThis.__directChatTest })
  const all = () => descendants(environment.container)
  const named = name => all().find(node => props(node)?.['aria-label'] === name)
  const button = name => all().find(node => node.tagName === 'BUTTON' && node.textContent === name)
  const click = async name => { const node = button(name); assert.ok(node, `Button ${name} exists`); assert.equal(node.disabled, false); await act(async () => { props(node).onClick?.({ preventDefault() {} }) }); await flush() }
  const type = async (text, name = 'Message') => { await act(async () => props(named(name)).onChange({ target: { value: text } })) }
  const send = async (twice = false) => { await act(async () => { const submit = props(named('Chat composer')).onSubmit; submit({ preventDefault() {} }); if (twice) submit({ preventDefault() {} }) }); await flush() }
  const consent = async () => { if (button('Allow and ask Anka AI')) await click('Allow and ask Anka AI') }
  return { all, scopeController, fixture, storage, environment, render, named, button, click, type, send, consent, reload: async () => { key++; await render() } }
}

test('readiness rejection ends loading; read-only retry restores Send without dispatch', async t => {
  let fail=true, calls=0
  const ui=await mount(t,{readiness:async()=>{calls++;if(fail)throw Error('offline');return {paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured'}}})
  assert.match(ui.environment.container.textContent,/AI availability could not be checked/)
  assert.doesNotMatch(ui.environment.container.textContent,/Checking AI availability/)
  assert.ok(ui.button('Send'));assert.ok(ui.button('Save message without AI'))
  fail=false;await ui.click('Retry AI availability')
  assert.ok(ui.button('Send'))
  assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0})
  assert(calls>=2)
})

test('stalled readiness times out and ignores late success; aborted scope never becomes ready', async t => {
  const original=globalThis.setTimeout,timers=[]
  globalThis.setTimeout=(callback,delay,...args)=>delay===15000?(timers.push(callback),0):original(callback,delay,...args)
  t.after(()=>{globalThis.setTimeout=original})
  const pending=[]
  const ui=await mount(t,{readiness:(_input,scope)=>{const deferred=defer();pending.push({...deferred,signal:scope.signal});return deferred.promise}})
  assert.match(ui.environment.container.textContent,/Checking AI availability/)
  await act(async()=>timers.at(-1)())
  assert.match(ui.environment.container.textContent,/AI availability could not be checked/)
  assert.equal(pending.at(-1).signal.aborted,true)
  await act(async()=>pending.forEach(item=>item.resolve({paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured'})))
  assert.ok(ui.button('Save message without AI'));assert.ok(ui.button('Send'))
  await ui.click('Retry AI availability')
  await act(async()=>ui.scopeController.abort())
  await act(async()=>pending.at(-1).resolve({paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured'}))
  assert.ok(ui.button('Send'))
  assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0})
})

test('genuine unavailability keeps AI Send distinct from explicit human-only save; malformed readiness is a failed check', async t=>{
  const ui=await mount(t,{readiness:async()=>({paid_execution_enabled:false,spend_tracking_configured:true,model_status:'configured'})})
  assert.ok(ui.button('Save message without AI'));assert.ok(ui.button('Send'))
  assert.doesNotMatch(ui.environment.container.textContent,/Checking AI availability/)
  ui.fixture.chat.getContextChatReadiness=async()=>null
  await ui.reload()
  assert.match(ui.environment.container.textContent,/AI availability could not be checked/)
  assert.ok(ui.button('Save message without AI'))
  assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0})
})

test('Project AI Send rechecks stale ready state and blocks expired pricing before saving a message',async t=>{
 const ui=await mount(t,{surface:'project'});await ui.type('Please update me on the homepage')
 ui.fixture.readiness={...ui.fixture.readiness,model_status:'price_unavailable'}
 await ui.send()
 assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0})
 assert.equal(ui.named('Message').value,'Please update me on the homepage')
 assert.match(ui.environment.container.textContent,/pricing.*unavailable or expired/)
 assert.equal(ui.button('Allow and ask Anka AI'),undefined)
 assert.ok(ui.button('Save message without AI'))
})

test('Project AI Send uses fresh eligibility after a failed background check and asks for exactly one reply',async t=>{
 let available=false;const reads=[]
 const ui=await mount(t,{surface:'project',readiness:async input=>{reads.push(input);if(!available)throw Error('temporary read failure');return {paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured'}}})
 await ui.type('Please update me on the homepage');const readsBefore=reads.length;available=true
 await ui.send(true);assert.equal(ui.button('Allow and ask Anka AI'),undefined)
 assert.deepEqual(ui.fixture.data.counters,{created:1,messages:1,run:1,recover:0});assert.deepEqual(reads.slice(readsBefore).map(input=>input.conversation_id),[undefined,ui.fixture.data.rows[0].id])
 assert.match(ui.environment.container.textContent,/Reply saved/);assert.equal(ui.named('Message').value,'')
})

test('a delayed Send readiness check cannot save or dispatch into an aborted project',async t=>{
 const pending=defer(),ui=await mount(t,{surface:'project'})
 ui.fixture.chat.getContextChatReadiness=()=>pending.promise
 await ui.type('Keep this unsent draft');await ui.send()
 await act(async()=>ui.scopeController.abort());pending.resolve({paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured'});await flush()
 assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0})
 assert.equal(ui.named('Message').value,'Keep this unsent draft')
})

test('readiness failures preserve existing saved history and never request another reply for it',async t=>{
 const ui=await mount(t,{surface:'project',state:'populated',initial:true}),original=structuredClone(ui.fixture.data.messages)
 ui.fixture.readiness={...ui.fixture.readiness,paid_execution_enabled:false}
 await ui.type('New unsent question');await ui.send()
 assert.deepEqual(ui.fixture.data.messages,original);assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0})
 assert.equal(ui.named('Message').value,'New unsent question')
})

test('New Project Chat owner can review and explicitly activate before first Send, without losing draft or automatic writes',async t=>{
 const requests=[],rpcs=[];let activated=false;
 const ui=await mount(t,{surface:'project',role:'system_owner',
  readiness:async input=>{requests.push(input);return {paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured',spend_guard_mode:'provider_managed',
   spend_readiness_status:activated?'ready':'prior_cycle_reconciliation_required',prospective_allowance_status:activated?'available':'inactive',prospective_maximum_hold_microusd:80480,
   ...(activated?{prospective_allowance:{remaining_microusd:1000000,expires_at:'2030-01-01',maximum_turn_microusd:80480}}:{})}},
  allowanceRpc:async(name,args)=>{rpcs.push({name,args});if(name==='read_owned_project_chat_allowance')return {data:activated?{status:'active',policy_id:'policy',cap_microusd:1000000,expires_at:'2030-01-01'}:{status:'none'}};
   if(name==='preview_project_chat_allowance')return {data:{organization_id:args.p_org,actor_id:actor,project_id:args.p_project,model_configuration_id:args.p_model,cap_microusd:args.p_cap,duration_seconds:args.p_seconds,review_hash:'a'.repeat(64),historical_costs_unresolved:true,historical_charge_may_exceed_estimate:true}};
   assert.equal(name,'apply_project_chat_allowance');assert.equal(args.p_action,'activate');activated=true;return {data:{must_not_dispatch:true,action:{request_id:args.p_request,action:'activate',actor_id:actor,policy_id:'policy',project_id:args.p_project,model_configuration_id:args.p_model,cap_microusd:args.p_cap,duration_seconds:args.p_seconds}}};
  }});
 await ui.type('help me setup this project');await ui.send();assert.equal(ui.named('Message').value,'help me setup this project');
 assert.equal(requests[0].project_id,ui.fixture.scope.project_id);assert.equal(requests[0].conversation_id,undefined);
 await ui.click('Review Project Chat allowance');await flush();await flush();
 for(let i=0;i<40&&!ui.button('Preview allowance');i++)await act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
 assert.ok(ui.button('Preview allowance'),ui.environment.container.textContent+JSON.stringify(rpcs));assert.equal(rpcs.filter(r=>r.name!=='read_owned_project_chat_allowance').length,0);
 const labels=ui.all().filter(n=>n.tagName==='LABEL');
 for(const [label,value] of [['New-text cap (USD)','1'],['Expires after (minutes)','60']]){
  const input=descendants(labels.find(n=>n.textContent.includes(label))).find(n=>n.tagName==='INPUT');
  await act(async()=>props(input).onChange({target:{value}}));
 }
 const form=ui.all().find(n=>n.tagName==='FORM'&&n.textContent.includes('Preview allowance'));
 await act(async()=>props(form).onSubmit({preventDefault(){}}));await flush();
 assert.equal(activated,false);assert.ok(ui.button('Accept exposure and activate allowance'));
 await ui.click('Accept exposure and activate allowance');await flush();await flush();
 assert.equal(activated,true);assert.equal(ui.named('Message').value,'help me setup this project');
 assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0});
 await ui.send();assert.deepEqual(ui.fixture.data.counters,{created:1,messages:1,run:1,recover:0});
 assert.equal(rpcs.filter(r=>r.name==='apply_project_chat_allowance').length,1);
});

test('New Project Chat nonowner membership never exposes allowance controls or calls policy RPC',async t=>{
 let calls=0;
 const blocked=async()=>({paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured',spend_readiness_status:'prior_cycle_reconciliation_required',prospective_allowance_status:'inactive'});
 const ui=await mount(t,{surface:'project',role:'operations_admin',readiness:blocked,allowanceRpc:async()=>{calls++;throw Error('unexpected')}});
 await ui.click('Chat settings');await flush();assert.equal(ui.button('Preview allowance'),undefined);assert.equal(calls,0);
 assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0});
});

test('New Project Chat model switch discards stale readiness and scopes allowance reads to the selected model',async t=>{
 const second='a0000000-0000-4000-8000-000000000099',late=defer(),reads=[];
 const models=structuredClone(allowlist);models.connections[0].context_model_configurations.push({id:second,model_id:'Second approved fixture'});
 const ui=await mount(t,{surface:'project',role:'system_owner',allowlist:models,readiness:async input=>{reads.push(input);if(input.model_configuration_id!==second)return late.promise;
  return {paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured',spend_readiness_status:'prior_cycle_reconciliation_required',prospective_allowance_status:'inactive'}},
  allowanceRpc:async()=>({data:{status:'none'}})});
 await ui.click('Chat settings');await act(async()=>props(ui.named('Approved model')).onChange({target:{value:second}}));await flush();await flush();
 late.resolve({paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured',spend_readiness_status:'ready',prospective_allowance_status:'available'});await flush();
 for(let i=0;i<40&&!ui.button('Preview allowance');i++)await act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
 assert.equal(props(ui.named('Approved model')).value,second);assert.ok(ui.button('Preview allowance'));
 assert.match(ui.environment.container.textContent,/Review a separate Project Chat/);
 assert.equal(reads.at(-1).model_configuration_id,second);assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0});
});

test('initial empty Project Chat usage-only readiness needs no allowance or Send attempt and keeps paid-off/model gates',async t=>{
 let allowed=true;
 const ui=await mount(t,{surface:'project',role:'system_owner',readiness:async()=>({
  paid_execution_enabled:allowed,spend_tracking_configured:true,model_status:'configured',
  spend_readiness_status:'ready',project_chat_spend_policy:'usage_only',unresolved_charges:true}),
  allowanceRpc:async()=>{throw Error('Usage-only must not call allowance APIs')}});
 assert.equal(ui.named('Message').value,'');assert.equal(ui.button('Send').disabled,true);
 assert.equal(ui.button('Review Project Chat allowance'),undefined);
 assert.match(ui.environment.container.textContent,/Usage tracked/);
 assert.doesNotMatch(ui.environment.container.textContent,/Costs are calculated from provider tokens and verified rates, not final invoices/);
 await ui.click('Chat settings');await flush();assert.equal(ui.button('Preview allowance'),undefined);
 assert.match(ui.environment.container.textContent,/Costs are calculated from provider tokens and verified rates, not final invoices/);
 assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0});
 await ui.type('A new explicitly typed text request');await ui.send();
 assert.deepEqual(ui.fixture.data.counters,{created:1,messages:1,run:1,recover:0});
 allowed=false;await ui.type('Keep this paid-off draft');await ui.send();
 assert.equal(ui.named('Message').value,'Keep this paid-off draft');
 assert.deepEqual(ui.fixture.data.counters,{created:1,messages:1,run:1,recover:0});
 assert.match(ui.environment.container.textContent,/currently disabled/);
});

test('usage-only separates a newly typed message while original check-only identity and newer pending recovery survive late reply',async t=>{
 const ui=await mount(t,{surface:'project',role:'system_owner',readiness:async()=>({
  paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured',spend_readiness_status:'ready',
  project_chat_spend_policy:'usage_only',unresolved_charges:true}),allowanceRpc:async()=>{throw Error('No allowance API')}});
 const originalRecover=ui.fixture.runner.recover;
 ui.fixture.runFailure=true;
 await ui.type('Original saved request');await ui.send();
 const original=ui.fixture.data.messages.find(x=>x.role==='user'),originalCalls=ui.fixture.data.counters.run;
 ui.fixture.runner.recover=async()=>{ui.fixture.data.counters.recover++;throw Object.assign(Error('No submission recorded at check time'),{
  outcome:'no_submission_recorded',mustNotSubmit:true,spendReadinessStatus:'prior_cycle_reconciliation_required',reconciliationSources:[]})};
 await ui.click('Check recovery');await flush();
 assert.ok(ui.button('Write a separate new message'));
 assert.doesNotMatch(ui.environment.container.textContent,/review a separate allowance/i);
 await ui.click('Write a separate new message');
 assert.equal(ui.named('Message').value,'');assert.equal(ui.fixture.data.counters.run,originalCalls);
 await ui.type('A separately typed newer request');await ui.send();
 const newer=ui.fixture.data.messages.filter(x=>x.role==='user').at(-1);
 assert.notEqual(newer.client_request_id,original.client_request_id);
 const pendingBefore=[...ui.storage.values()].map(value=>JSON.parse(value)).find(record=>record.message_id===newer.id&&record.dispatch_request_id);
 assert.ok(pendingBefore,'newer exact recovery identity stored before earlier reply arrives');
 ui.fixture.recoveryAvailable=true;ui.fixture.runner.recover=originalRecover;
 await ui.click('Check earlier saved reply');
 assert.equal(ui.fixture.data.counters.run,originalCalls+1);
 assert.ok(ui.button('Check recovery'),'newer pending request remains independently recoverable');
 assert.equal(ui.named('Message').value,'A separately typed newer request');
 assert([...ui.storage.values()].some(value=>value===JSON.stringify(pendingBefore)),'newer exact identity unchanged after earlier recovery');
 assert(ui.fixture.data.messages.some(x=>x.role==='assistant'&&x.in_reply_to_message_id===original.id));
});

test('projection-accurate saved recovery refuses foreign message scope then checks the original without resending or losing an unresolved draft',async t=>{
 const ui=await mount(t,{surface:'project',role:'system_owner',readiness:async()=>({
  paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured',
  spend_readiness_status:'ready',project_chat_spend_policy:'usage_only',unresolved_charges:true})});
 ui.fixture.runFailure=true;await ui.type('Keep the original unsolved draft');await ui.send();
 const original=ui.fixture.data.messages.find(row=>row.role==='user'),originalRead=ui.fixture.chat.getContextConversation;
 let foreign=true;
 const columns=['id','conversation_id','author_id','role','body','status','client_request_id','sequence','created_at','finished_at','in_reply_to_message_id'];
 ui.fixture.chat.getContextConversation=async input=>{
  const result=await originalRead(input);
  return {...result,messages:result.messages.map(row=>Object.fromEntries(columns.filter(key=>key in row).map(key=>[key,key==='conversation_id'&&foreign?'c0000000-0000-4000-8000-000000000099':row[key]])))};
 };
 await ui.reload();
 assert.match(ui.environment.container.textContent,/original AI request cannot be checked/);
 assert.equal(ui.fixture.data.counters.run,1);assert.equal(ui.fixture.data.counters.recover,0);
 assert.equal(ui.named('Message').value,'Keep the original unsolved draft');
 foreign=false;ui.fixture.recoveryAvailable=false;
 await ui.click('Check recovery');
 assert.doesNotMatch(ui.environment.container.textContent,/original AI request cannot be checked/);
 assert.equal(ui.fixture.data.counters.run,1);assert.equal(ui.fixture.data.counters.recover,1);
 assert.equal(ui.named('Message').value,'Keep the original unsolved draft');
 assert.ok([...ui.storage.values()].some(value=>{const record=JSON.parse(value);return record.message_id===original.id&&record.client_request_id===original.client_request_id}));
 ui.fixture.recoveryAvailable=true;await ui.click('Check recovery');
 assert.equal(ui.fixture.data.counters.run,1);assert.equal(ui.fixture.data.counters.recover,2);
 assert.equal(ui.fixture.data.messages.filter(row=>row.role==='user').length,1);
 assert(ui.fixture.data.messages.some(row=>row.role==='assistant'&&row.in_reply_to_message_id===original.id));
 assert.equal(ui.button('Check recovery'),undefined);
});

test('stalled initial recovery releases busy after deadline without clearing original identity or draft',async t=>{
 const real=globalThis.setTimeout,timers=[];
 globalThis.setTimeout=(callback,delay,...args)=>delay===15000?(timers.push(callback),0):real(callback,delay,...args);
 t.after(()=>{globalThis.setTimeout=real});
 const ui=await mount(t,{surface:'project',role:'system_owner'});
 ui.fixture.runFailure=true;await ui.type('Preserve stalled original draft');await ui.send();
 const before=[...ui.storage.entries()];
 const late=defer();ui.fixture.chat.getContextConversation=()=>late.promise;
 await ui.reload();
 assert.equal(ui.button('Check recovery').disabled,true);
 await act(async()=>{for(const callback of timers.splice(0))callback()});await flush();
 assert.equal(ui.button('Check recovery').disabled,false);
 assert.match(ui.environment.container.textContent,/timed out/);
 assert.equal(ui.named('Message').value,'Preserve stalled original draft');
 for(const [key,value] of before)assert.equal(ui.storage.get(key),value);
 assert.equal(ui.fixture.data.counters.run,1);
 late.resolve({conversation:{id:'foreign'},messages:[]});await flush();
 assert.equal(ui.named('Message').value,'Preserve stalled original draft');
 for(const [key,value] of before)assert.equal(ui.storage.get(key),value);
});

test('stalled runner recovery times out, explicit check can recover, and late old success cannot clear preserved state',async t=>{
 const real=globalThis.setTimeout,timers=[];
 globalThis.setTimeout=(callback,delay,...args)=>delay===15000?(timers.push(callback),0):real(callback,delay,...args);
 t.after(()=>{globalThis.setTimeout=real});
 const ui=await mount(t,{surface:'project',role:'system_owner'});
 ui.fixture.runFailure=true;await ui.type('Runner timeout draft');await ui.send();
 const before=[...ui.storage.entries()],originalRecover=ui.fixture.runner.recover,late=defer();
 ui.fixture.runner.recover=()=>late.promise;await ui.reload();
 await act(async()=>{for(const callback of timers.splice(0))callback()});await flush();
 assert.equal(ui.button('Check recovery').disabled,false);
 assert.equal(ui.named('Message').value,'Runner timeout draft');
 for(const [key,value] of before)assert.equal(ui.storage.get(key),value);
 late.resolve({status:'completed'});await flush();
 assert.equal(ui.named('Message').value,'Runner timeout draft');
 for(const [key,value] of before)assert.equal(ui.storage.get(key),value);
 ui.fixture.runner.recover=originalRecover;ui.fixture.recoveryAvailable=true;
 await ui.click('Check recovery');assert.equal(ui.button('Check recovery'),undefined);
 assert.equal(ui.fixture.data.counters.run,1);
 assert.equal(ui.fixture.data.messages.filter(row=>row.role==='user').length,1);
});

test('timeout navigation exemption belongs only to its original pending request',async t=>{
 const real=globalThis.setTimeout,timers=[];let navigationBusy;
 globalThis.setTimeout=(callback,delay,...args)=>delay===15000?(timers.push(callback),0):real(callback,delay,...args);
 t.after(()=>{globalThis.setTimeout=real});
 const ui=await mount(t,{surface:'project',role:'system_owner',onNavigationBusyChange:value=>{navigationBusy=value}});
 ui.fixture.runFailure=true;await ui.type('First explicit request');await ui.send();
 const originalRecover=ui.fixture.runner.recover;
 ui.fixture.runner.recover=()=>new Promise(()=>{});await ui.reload();
 assert.equal(navigationBusy,true);
 await act(async()=>{for(const callback of timers.splice(0))callback()});await flush();
 assert.equal(navigationBusy,false);
 ui.fixture.runner.recover=originalRecover;ui.fixture.recoveryAvailable=true;await ui.click('Check recovery');
 assert.equal(ui.button('Check recovery'),undefined);
 ui.fixture.recoveryAvailable=false;await ui.type('Second explicit request');await ui.send();
 assert.ok(ui.button('Check recovery'));assert.equal(navigationBusy,true);
 assert.equal(ui.fixture.data.counters.run,2);
 ui.fixture.runner.recover=()=>new Promise(()=>{});
 // Click without awaiting the intentionally stalled event promise.
 await act(async()=>{props(ui.button('Check recovery')).onClick()});await flush();
 await act(async()=>{for(const callback of timers.splice(0))callback()});await flush();
 assert.equal(navigationBusy,false);
 assert.equal(ui.named('Message').value,'Second explicit request');
 assert.equal(ui.fixture.data.counters.run,2);
});
test('generic initial history timeout cannot exempt a later pending request',async t=>{
 const real=globalThis.setTimeout,timers=[];let navigationBusy;
 globalThis.setTimeout=(callback,delay,...args)=>delay===15000?(timers.push(callback),0):real(callback,delay,...args);
 t.after(()=>{globalThis.setTimeout=real});
 const ui=await mount(t,{surface:'project',initial:true,read:()=>new Promise(()=>{}),onNavigationBusyChange:value=>{navigationBusy=value}});
 await act(async()=>{for(const callback of timers.splice(0))callback()});await flush();
 assert.equal(navigationBusy,false);
 ui.fixture.runFailure=true;await ui.type('New explicit request after history failure');await ui.send();
 assert.ok(ui.button('Check recovery'));assert.equal(navigationBusy,true);
 assert.equal(ui.fixture.data.counters.run,1);
});
