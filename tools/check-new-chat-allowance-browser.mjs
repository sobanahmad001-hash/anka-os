import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:5266',reports=[];
const server=spawn(process.execPath,['tools/direct-chat-preview.mjs'],{env:{...process.env,ANKA_DIRECT_CHAT_PREVIEW_PORT:'5266'},windowsHide:true,stdio:'inherit'});
let browser;
try{
 const until=Date.now()+60000;while(true){try{if((await fetch(base+'/tools/direct-chat-preview.html')).ok)break}catch{}if(Date.now()>until)throw Error('Preview unavailable');await new Promise(r=>setTimeout(r,200));}
 await mkdir('outputs/new-chat-allowance',{recursive:true});
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 for(const width of [390,1440]){
  const scenario='owner',page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:5266\/)/,r=>r.abort());
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

  await page.goto(base+'/tools/direct-chat-preview.html?surface=project&state=empty&allowance=owner',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Message',{exact:true}).fill('help me setup this project');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Earlier AI charges remain unresolved'}).waitFor();
  assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'help me setup this project');
  await page.screenshot({path:'outputs/new-chat-allowance/blocked-'+width+'.png'});
  await page.getByRole('button',{name:'Review Project Chat allowance',exact:true}).click();
  await page.getByLabel('New-text cap (USD)').fill('0.25');
  await page.getByLabel('Expires after (minutes)').fill('5');
  await page.getByRole('button',{name:'Preview allowance',exact:true}).click();
  await page.getByRole('button',{name:'Accept exposure and activate allowance',exact:true}).waitFor();
  await page.screenshot({path:'outputs/new-chat-allowance/review-'+width+'.png'});
  assert.deepEqual(await page.evaluate(()=>__directChatPreview.fixture.data.counters),{created:0,messages:0,run:0,recover:0});
  await page.getByRole('button',{name:'Accept exposure and activate allowance',exact:true}).click();
  await page.getByText(/remaining for new text/).waitFor();
  assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'help me setup this project');
  assert.deepEqual(await page.evaluate(()=>__directChatPreview.fixture.data.counters),{created:0,messages:0,run:0,recover:0});
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('Reply saved.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>__directChatPreview.fixture.data.counters),{created:1,messages:1,run:1,recover:0});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);
  reports.push({width,newChat:true,explicitActivation:true,draftPreserved:true,noAutomaticWrites:true,normalSendOnce:true,noOverflow:true,externalRequests:false});await page.close();
 }
 await writeFile('outputs/new-chat-allowance/verification.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));
}finally{await browser?.close();server.kill();}
