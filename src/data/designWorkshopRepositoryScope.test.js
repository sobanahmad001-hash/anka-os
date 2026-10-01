import test from 'node:test'
import assert from 'node:assert/strict'
import { invokeDesignFunction } from './designWorkshopRequest.js'

function functionClient(handler) {
  return {
    functions: { invoke: handler },
    from() { throw new Error('A table read was not expected in this test') },
  }
}

test('Design invoke preserves an envelope-only 403 and passes the current abort signal', async () => {
  const controller = new AbortController()
  let received
  const client = functionClient(async (name, options) => {
    received = { name, options }
    return { data: null, error: { message: 'Denied', context: { status: 403 } } }
  })
  await assert.rejects(invokeDesignFunction(client, 'design-workshop', 'org-1', 'create_page_flow', { flow_name: 'Launch' }, { signal: controller.signal }), error => error.status === 403 && error.cause?.context?.status === 403)
  assert.equal(received.name, 'design-workshop')
  assert.equal(received.options.signal, controller.signal)
  assert.equal(received.options.body.organization_id, 'org-1')
})

test('an already-stale Design scope makes no function request', async () => {
  const controller = new AbortController()
  controller.abort(new DOMException('Scope changed', 'AbortError'))
  let calls = 0
  const client = functionClient(async () => { calls += 1; return { data: { data: {} }, error: null } })
  await assert.rejects(invokeDesignFunction(client, 'design-workshop', 'org-1', 'create_page_flow', { flow_name: 'Launch' }, { signal: controller.signal }), error => error.name === 'AbortError')
  assert.equal(calls, 0)
})

test('canonical brief transport releases edits only after an explicitly verified atomic rollback',async()=>{
 const context=new Response(JSON.stringify({error:'Changed exact revision',code:'40001',rollback_verified:true}),{status:409})
 const client={functions:{invoke:async()=>({data:null,error:{message:'Edge HTTP error',context}})}}
 try {await invokeDesignFunction(client,'design-workshop','org','confirm_video_brief',{})} catch(error){assert.equal(error.knownRollback,true);assert.equal(error.code,'40001');assert.equal(error.message,'Changed exact revision')}
 const unknown={functions:{invoke:async()=>({data:null,error:{message:'Lost response',context:new Response('unknown',{status:503})}})}}
 try {await invokeDesignFunction(unknown,'design-workshop','org','confirm_video_brief',{})} catch(error){assert.equal(error.knownRollback,false)}
 try {await invokeDesignFunction(client,'design-workshop','org','generate_video',{})} catch(error){assert.equal(error.knownRollback,false)}
})
