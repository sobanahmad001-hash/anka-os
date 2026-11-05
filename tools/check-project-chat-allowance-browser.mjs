import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Soban/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const base='http://127.0.0.1:5264', reports=[]
const server=spawn(process.execPath,['tools/direct-chat-preview.mjs'],{env:{...process.env,ANKA_DIRECT_CHAT_PREVIEW_PORT:'5264'},windowsHide:true,stdio:'inherit'})
let browser
try {
  const until=Date.now()+60000
  while(true){try{if((await fetch(base+'/tools/direct-chat-preview.html')).ok)break}catch{}if(Date.now()>until)throw Error('Local preview unavailable');await new Promise(r=>setTimeout(r,250))}
  await mkdir('outputs/allowance',{recursive:true})
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'})
  for(const scenario of ['owner','lost','expired','replay','fresh-intent','paid-off','price-off','non-owner']){
    const page=await browser.newPage({viewport:{width:scenario==='lost'?390:1440,height:900}})
    const errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:5264\/)/,r=>r.abort())
    await page.addInitScript(({scenario})=>{
      const actor='a0000000-0000-4000-8000-000000000001', policyId='b0000000-0000-4000-8000-000000000001'
      const f=globalThis.__allowanceFixture={
        calls:[],scopes:[],paid:scenario!=='paid-off',policy:{status:'none'},
        readiness(input,fixture){
          this.scopes.push(input.conversation_id)
          const available=this.policy.status==='active'
          return {...fixture.readiness,model_status:scenario==='price-off'?'price_unavailable':'configured',paid_execution_enabled:this.paid,spend_readiness_status:available?'ready':'prior_cycle_reconciliation_required',
            prospective_maximum_hold_microusd:80480,prospective_allowance_status:available?'available':'inactive',prospective_allowance:available?{maximum_turn_microusd:80480,remaining_microusd:180000,expires_at:this.policy.expires_at}:null}
        },
        async rpc(name,args){
          this.calls.push({name,args})
          if(name==='read_owned_project_chat_allowance')return {data:this.policy}
          if(name==='preview_project_chat_allowance')return {data:{organization_id:args.p_org,project_id:args.p_project,model_configuration_id:args.p_model,actor_id:actor,
            cap_microusd:args.p_cap,duration_seconds:args.p_seconds,review_hash:'a'.repeat(64),historical_costs_unresolved:true,historical_charge_may_exceed_estimate:true}}
          if(name!=='apply_project_chat_allowance')throw Error('Unexpected RPC')
          if(args.p_action==='activate'){this.policy={status:'active',policy_id:policyId,cap_microusd:args.p_cap,expires_at:new Date(Date.now()+300000).toISOString()}
            if(scenario==='replay')this.policy.status='revoked'
            if(scenario==='lost'||scenario==='expired')throw TypeError('Lost response')}
          else{if(args.p_policy!==policyId)throw Error('Wrong revoke target');this.policy={...this.policy,status:'revoked'}}
          return {data:{action:{request_id:args.p_request,actor_id:actor,policy_id:policyId,action:args.p_action,project_id:args.p_project,model_configuration_id:args.p_model,cap_microusd:args.p_cap,duration_seconds:args.p_seconds},must_not_dispatch:true}}
        }
      }
    },{scenario})
    await page.goto(base+'/tools/direct-chat-preview.html?surface=project&state='+(scenario==='fresh-intent'?'uncertain':'populated')+'&allowance='+(scenario==='non-owner'?'staff':'owner'),{waitUntil:'domcontentloaded'})
    await page.waitForFunction(()=>__allowanceFixture.scopes.includes('a0000000-0000-4000-8000-000000000005'))
    let original
    if(scenario==='fresh-intent'){
      original=await page.evaluate(()=>{
        const fixture=__directChatPreview.fixture
        fixture.beforeRun=input=>{__allowanceFixture.dispatched=input}
        const run=fixture.runner.run
        fixture.runner.run=async (...args)=>{await run(...args);throw TypeError('New response lost')}
        fixture.runner.recover=async id=>{
          if(id!=='a0000000-0000-4000-8000-000000000007')throw Error('Wrong original message')
          throw Object.assign(Error('No submission was recorded at this check. The original request may still be in progress.'),{outcome:'no_submission_recorded',mustNotSubmit:true,spendReadinessStatus:'prior_cycle_reconciliation_required'})
        }
        return JSON.parse(Object.entries(sessionStorage).find(([k])=>k.startsWith('anka:direct-chat:b1:') && k.endsWith(']'))[1])
      })
      await page.getByRole('button',{name:'Check recovery',exact:true}).click()
      await page.getByRole('status').filter({hasText:'Earlier charges remain unresolved'}).waitFor()
      assert.equal(await page.getByRole('button',{name:'Write a separate new message'}).count(),0)
    }
    await page.locator('details.direct-project-tools > summary').click()
    await page.getByRole('button',{name:'Chat settings'}).click()
    await page.waitForFunction(()=>__allowanceFixture.scopes.includes('a0000000-0000-4000-8000-000000000005'))
    const preview=page.getByRole('button',{name:'Preview allowance'})
    if(['paid-off','price-off','non-owner'].includes(scenario)){
      if(scenario!=='non-owner')await page.waitForFunction(()=>__allowanceFixture.calls.some(c=>c.name.startsWith('read_owned')))
      assert.equal(await preview.count(),0)
      if(scenario==='paid-off')assert.doesNotMatch(await page.locator('body').innerText(),/Review a separate Project Chat text allowance/)
    }else{
      await page.getByText(/full .*0\.08048 hold/).waitFor()
      await page.getByLabel('New-text cap (USD)').fill('0.25')
      await page.getByLabel('Expires after (minutes)').fill('5')
      await preview.click()
      const apply=page.getByRole('button',{name:'Accept exposure and activate allowance'})
      await apply.waitFor()
      await page.getByLabel('Expires after (minutes)').fill('6')
      assert.equal(await apply.count(),0)
      await preview.click()
      if(scenario==='owner')await page.getByRole('region',{name:'Project Chat text allowance'}).screenshot({path:'outputs/allowance/owner-preview.png'})
      await apply.evaluate(el=>{el.click();el.click()})
      if(scenario==='lost'||scenario==='expired'){
        await page.getByText('The original action may still be in progress.',{exact:false}).waitFor()
        const key=await page.evaluate(()=>Object.keys(sessionStorage).find(k=>k.startsWith('anka:project-chat-allowance:')))
        const saved=await page.evaluate(k=>sessionStorage.getItem(k),key)
        await page.getByRole('button',{name:'Check current policy'}).click()
        assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),saved)
      }
      if(scenario==='expired'){
        await page.evaluate(()=>{__allowanceFixture.policy.status='expired'})
        await page.getByRole('button',{name:'Check current policy'}).click()
        await page.getByRole('button',{name:'Start a separate allowance review'}).click()
        await page.getByText('An earlier action has no confirmed receipt.',{exact:false}).waitFor()
        assert.equal(await page.evaluate(()=>__allowanceFixture.calls.filter(c=>c.name.startsWith('apply_project')).length),1)
      }else
      if(scenario==='replay'){
        await page.getByText('Action receipt verified. Current policy status: revoked.').waitFor()
        assert.equal(await page.getByRole('button',{name:'Revoke this allowance'}).count(),0)
      }else{
      await page.getByText(/remaining for new text/).waitFor()
      if(scenario==='fresh-intent'){
        await page.getByRole('button',{name:'Write a separate new message'}).click()
        assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'')
        await page.getByLabel('Message',{exact:true}).fill('New independent owner intent')
        const readsBefore=await page.evaluate(()=>__allowanceFixture.scopes.length)
        await page.getByRole('button',{name:'Send',exact:true}).evaluate(button=>{button.click();button.click()})
        await page.getByRole('alert').filter({hasText:'New response lost'}).waitFor()
        const result=await page.evaluate(()=>({input:__allowanceFixture.dispatched,reads:__allowanceFixture.scopes.slice(),human:__directChatPreview.fixture.data.messages.find(row=>row.body==='New independent owner intent'),saved:JSON.parse(Object.entries(sessionStorage).find(([k])=>k.includes(':saved-check:'))[1])}))
        assert.deepEqual(result.saved,original)
        assert.notEqual(result.human.client_request_id,original.client_request_id)
        assert.notEqual(result.input.dispatch_request_id,original.dispatch_request_id)
        assert.equal(result.input.message_id,result.human.id);assert.notEqual(result.human.id,original.message_id)
        assert.equal(result.human.conversation_id,original.conversation_id)
        assert.equal(result.reads.slice(readsBefore)[0],original.conversation_id)
        await page.getByRole('button',{name:'Check earlier saved reply'}).click()
        await page.getByRole('alert').filter({hasText:'original request may still be in progress'}).waitFor()
      }
      if(scenario==='lost')await page.getByRole('region',{name:'Project Chat text allowance'}).screenshot({path:'outputs/allowance/current-after-lost-response.png'})
      await page.evaluate(()=>{__allowanceFixture.paid=false})
      await page.getByRole('button',{name:'Check current policy'}).click()
      await page.getByText('AI execution is currently off.').waitFor()
      await page.getByRole('button',{name:'Revoke this allowance'}).click()
      await page.getByText('Action receipt verified. Current policy status: revoked.').waitFor()
      if(scenario==='lost'){
        await page.evaluate(()=>{__allowanceFixture.paid=true})
        await page.getByRole('button',{name:'Start a separate allowance review'}).click()
        await page.getByText('An earlier action has no confirmed receipt.',{exact:false}).waitFor()
        await page.getByLabel('New-text cap (USD)').fill('0.18')
        await page.getByLabel('Expires after (minutes)').fill('9')
        await preview.click()
        await page.getByRole('button',{name:'Accept exposure and activate allowance'}).waitFor()
        assert.equal(await page.evaluate(()=>JSON.parse(Object.entries(sessionStorage).find(([k])=>k.endsWith(':unconfirmed'))[1])[0].requestId),await page.evaluate(()=>__allowanceFixture.calls.find(c=>c.args.p_action==='activate').args.p_request))
      }
      if(scenario==='fresh-intent'){
        const newOriginal=await page.evaluate(()=>JSON.parse(Object.entries(sessionStorage).find(([k])=>k.startsWith('anka:direct-chat:b1:')&&k.endsWith(']'))[1]))
        await page.reload({waitUntil:'domcontentloaded'})
        const earlier=page.getByRole('button',{name:'Check earlier saved reply'})
        await earlier.waitFor()
        await page.evaluate(()=>{__directChatPreview.fixture.recoveryAvailable=true})
        await earlier.click()
        await page.getByText('Earlier reply recovered from the original message.').waitFor()
        assert.equal(await earlier.count(),0)
        assert.deepEqual(await page.evaluate(()=>JSON.parse(Object.entries(sessionStorage).find(([k])=>k.startsWith('anka:direct-chat:b1:')&&k.endsWith(']'))[1])),newOriginal)
        await page.getByRole('button',{name:'Check recovery',exact:true}).click()
        await page.getByText('Send recovered. No new AI request was sent.').waitFor()
        const replies=await page.evaluate(()=>__directChatPreview.fixture.data.messages.filter(r=>r.role==='assistant').map(r=>r.in_reply_to_message_id))
        assert.equal(replies.filter(id=>id===original.message_id).length,1)
        assert.equal(replies.filter(id=>id===newOriginal.message_id).length,1)
      }
      const writes=await page.evaluate(()=>__allowanceFixture.calls.filter(c=>c.name.startsWith('apply_project')))
      if(scenario!=='fresh-intent')assert.deepEqual(writes.map(c=>c.args.p_action),['activate','revoke'])
      }
    }
    assert.equal(await page.evaluate(()=>__directChatPreview.fixture.data.counters.run),scenario==='fresh-intent'?1:0)
    assert.equal(await page.evaluate(()=>__directChatPreview.fixture.data.counters.messages),scenario==='fresh-intent'?1:0)
    assert.deepEqual(errors,[]);reports.push({scenario,passed:true,...(scenario==='fresh-intent'?{newTypedIntent:true,sameConversation:true,freshReadiness:true,newHumanMessages:1,newDispatches:1,originalRedispatches:0,duplicateClickSuppressed:true,separateRecoveryAfterReload:true,lateReplyCheckedAgainstOriginal:true}: {})});await page.close()
  }
  await mkdir('outputs/allowance',{recursive:true})
  await writeFile('outputs/allowance/verification.json',JSON.stringify({synthetic:true,reports},null,2))
  console.log(JSON.stringify(reports))
}finally{await browser?.close();server.kill()}
