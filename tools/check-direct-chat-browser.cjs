// Provider-free visual assertions against the isolated localhost fixture only.
// Windows example: node tools/check-direct-chat-browser.cjs <playwright-module> <output-directory>
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require(process.argv[2] || 'playwright')
const output = process.argv[3]
assert(output, 'An evidence output directory is required')
const base = 'http://127.0.0.1:5188/tools/direct-chat-preview.html'
async function websiteBulkAssertions(browser){
 const results=[]
 for(const [width,theme] of [[1440,'light'],[390,'dark']]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],blocked=[],screenshots=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&u.port==='5188')return route.continue();blocked.push(u.origin);return route.abort()})
  const open=async()=>{await page.goto(`${base}?panel=website-pages&theme=${theme}`);await page.getByRole('button',{name:'Find approved architectures',exact:true}).waitFor();await page.evaluate(()=>{globalThis.__directChatPreview.website.rows[1].page_id='a0000000-0000-4000-8000-000000000299'});await page.getByRole('button',{name:'Find approved architectures',exact:true}).click();const version=await page.evaluate(()=>globalThis.__directChatPreview.website.versionId);await page.getByLabel('Website approved architecture',{exact:true}).selectOption(version);await page.getByLabel('Select Welcome',{exact:true}).check();await page.getByLabel('Select Service page 2',{exact:true}).check();await page.getByRole('button',{name:'Change selected pages',exact:true}).click();await page.getByLabel('Bulk page template',{exact:true}).fill('Shared service landing');await page.getByRole('button',{name:'Preview bulk changes',exact:true}).click()}
  const shot=async label=>{await page.getByRole('region',{name:'Bulk Website page changes',exact:true}).scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const name=`p05-bulk-${label}-${theme}-${width}x900.png`;await page.screenshot({path:path.join(output,name)});screenshots.push(name)}
  await open();await page.getByText('Template: Landing → Shared service landing',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.calls.length),0);await shot('preview')
  await page.evaluate(()=>{const f=globalThis.__directChatPreview.website,original=f.repository.saveOperations;f.originalBulkSave=original;f.repository.saveOperations=async input=>{if(input.pageId===f.rows[1].page_id)throw Object.assign(new Error('Second page changed; review its current version.'),{knownRollback:true});return original(input)}})
  await page.getByRole('button',{name:'Confirm reviewed page changes',exact:true}).click();await page.getByText('Service page 2 · failed',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.calls.length),1);await shot('partial')
  await page.evaluate(()=>{const f=globalThis.__directChatPreview.website;f.repository.saveOperations=f.originalBulkSave});await page.getByRole('button',{name:'Review remaining pages',exact:true}).click();await page.getByRole('button',{name:'Confirm reviewed page changes',exact:true}).click();await page.getByText('2 saved · 0 unchanged · 0 remaining.',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.calls.length),2);assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.calls.filter(c=>c.pageId===globalThis.__directChatPreview.website.rows[0].page_id).length),1);await shot('complete')
  await open();await page.evaluate(()=>globalThis.__directChatPreview.website.setLost(true));await page.getByRole('button',{name:'Confirm reviewed page changes',exact:true}).click();await page.getByText('Welcome · uncertain',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.calls.length),1);assert(await page.getByRole('button',{name:'Review remaining pages',exact:true}).isDisabled());await shot('recovery');await page.getByRole('button',{name:'Check original operation',exact:true}).click();await page.getByText('Recovered the original confirmed operation. No command was repeated.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.calls.length),1)
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);results.push({width,height:900,theme,previewWrites:0,partialFailureIdentified:true,successfulPagesNeverRepeated:true,originalUuidRecovery:true,pageErrors:errors,blockedRemoteRequests:blocked,screenshots});await context.close()
 }
 const packet=path.join(output,'b2-service-native-evidence.json'),evidence=JSON.parse(await fs.readFile(packet,'utf8'));evidence.pageIdentity.bulkOperations={...evidence.pageIdentity.bulkOperations,browser:{source:'tools/check-direct-chat-browser.cjs --website-bulk',scope:'Actual Website bulk panel and Layout with isolated existing per-page native-operation fixture; no production/provider acceptance',results}};await fs.writeFile(packet,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({websiteBulkPassed:results.length,evidence:packet}))
}

async function projectNavigationAssertions(browser){
 const results=[]
 for(const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],consoleErrors=[],blocked=[],screenshots=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&u.port==='5188')return route.continue();blocked.push(u.origin);return route.abort()})
  await page.goto(`${base}?panel=project-navigation&surface=project&theme=${theme}`)
  const top=page.getByRole('tablist',{name:'Project workspace sections',exact:true});await top.waitFor();assert.deepEqual(await top.getByRole('tab').allTextContents(),['Chat','Overview','Work','Services & Pipelines','Files & Outputs','Reviews & Delivery','Activity']);assert.equal(await top.getByRole('tab',{name:'Chat',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await page.getByRole('region',{name:'Workspace summary',exact:true}).count(),0)
  const shot=async(name,node)=>{await node.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const file=`project-navigation-${name}-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,file)});screenshots.push(file)}
  await shot('chat',top)
  await top.getByRole('tab',{name:'Overview',exact:true}).click();await page.getByRole('link',{name:'Open Living Project Document & version history',exact:true}).waitFor();assert.equal(await page.getByRole('region',{name:'Workspace summary',exact:true}).count(),1);await shot('overview',page.getByRole('link',{name:'Open Resources & Connections',exact:true}))
  await top.getByRole('tab',{name:'Work',exact:true}).click();await page.getByRole('button',{name:'Website',exact:true}).click();const website=page.getByRole('region',{name:'Website work',exact:true});const identities=await page.evaluate(()=>({website:globalThis.__directChatPreview.website.group.id,marketing:globalThis.__directChatPreview.campaign.group.id}));assert.equal(await website.getByLabel('Website work pipeline',{exact:true}).inputValue(),'');await website.getByLabel('Website work pipeline',{exact:true}).selectOption(identities.website);await website.getByRole('button',{name:'Find approved architectures',exact:true}).click();const version=await page.evaluate(()=>globalThis.__directChatPreview.website.versionId);await website.getByLabel('Website approved architecture',{exact:true}).selectOption(version);await website.getByText(/^1.25 of 101 matching pages$/).waitFor();await shot('website',website)
  await page.getByRole('button',{name:'Marketing',exact:true}).click();const marketing=page.getByRole('region',{name:'Marketing work',exact:true});assert.equal(await marketing.getByLabel('Marketing work pipeline',{exact:true}).inputValue(),'');await marketing.getByLabel('Marketing work pipeline',{exact:true}).selectOption(identities.marketing);await page.getByText('Campaign assets and calendar',{exact:false}).first().click();await marketing.getByRole('button',{name:'Find campaigns',exact:true}).click();await marketing.getByText(/26 matches/).first().waitFor();await shot('marketing',marketing)
  await marketing.getByRole('button',{name:'Resources & Connections',exact:true}).click();const resources=page.getByRole('region',{name:'Resources & Connections',exact:true});assert.equal(await resources.getByLabel('Resources & Connections pipeline',{exact:true}).inputValue(),identities.marketing);assert.equal(await top.getByRole('tab',{name:'Overview',exact:true}).getAttribute('aria-selected'),'true');await page.getByText('Project reporting resources',{exact:false}).first().click();const binding=page.getByRole('region',{name:'Project reporting resources',exact:true});await binding.getByRole('button',{name:'Load project bindings',exact:true}).click();await binding.getByRole('article').first().waitFor();await binding.getByRole('button',{name:'Review binding',exact:true}).first().click();await binding.getByLabel('Reporting binding state',{exact:true}).selectOption('paused');assert.equal(await top.getByRole('tab',{name:'Work',exact:true}).isDisabled(),true);assert.equal(await resources.getByLabel('Resources & Connections pipeline',{exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Refresh',exact:true}).isDisabled(),true);await binding.getByRole('button',{name:'Discard binding review',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#project-tab-work').disabled);assert.equal(await top.getByRole('tab',{name:'Work',exact:true}).isDisabled(),false);await shot('resources',resources)
  await page.evaluate(()=>{const r=globalThis.__directChatPreview.router,p=r.state.location.pathname;r.navigate(p+'?tab=resources&resourceGroupId=foreign-project-pipeline')});await page.getByText('The requested pipeline is unavailable in this project. Choose a current exact pipeline.',{exact:true}).waitFor();assert.equal(await resources.getByLabel('Resources & Connections pipeline',{exact:true}).inputValue(),'');assert.equal(await page.getByRole('region',{name:'Project reporting resources',exact:true}).count(),0)
  const writes=await page.evaluate(()=>({website:globalThis.__directChatPreview.website.calls.length,campaign:globalThis.__directChatPreview.campaign.calls.length,reporting:globalThis.__directChatPreview.reporting.calls.length}));assert.deepEqual(writes,{website:0,campaign:0,reporting:0});assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(blocked,[]);results.push({width,height,theme,screenshots,exactTabOrder:true,defaultChat:true,conditionalWork:true,explicitPipelineIdentity:true,exactResourcesDeepLink:true,foreignIdentityUnavailable:true,actualChildReads:true,resourceDraftLocksAndDiscard:true,noWritesOrProvider:true,pageErrors:errors,consoleErrors,blockedRemoteRequests:blocked,horizontalOverflow:false});await context.close()
 }
 const evidence=path.join(output,'b2-service-native-evidence.json'),packet=JSON.parse(await fs.readFile(evidence,'utf8'));packet.projectNavigation={source:'tools/check-direct-chat-browser.cjs --project-navigation',scope:'Actual Project route, Layout, Website/Marketing/Resources components with scoped provider-free repositories. Unrelated lifecycle, PM, service/planning/discussion/review children are omitted in this navigation fixture; no signed-in/provider acceptance.',cases:results};await fs.writeFile(evidence,JSON.stringify(packet,null,2)+'\n');console.log(JSON.stringify({passed:results.length,evidence}))
}

async function storedReportingAssertions(browser){
 const results=[]
 for(const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],consoleErrors=[],blocked=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&u.port==='5188')return route.continue();blocked.push(u.origin);return route.abort()})
  await page.goto(`${base}?panel=reporting-bindings&storedReport=1&theme=${theme}`);await page.getByText('Project reporting resources · Launch marketing',{exact:true}).click()
  const parent=page.getByRole('region',{name:'Project reporting resources',exact:true});await parent.getByRole('button',{name:'Load project bindings',exact:true}).click();await parent.getByRole('button',{name:'Stored report',exact:true}).click()
  const report=page.getByRole('region',{name:'Stored project report',exact:true});assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.reporting.reportReads.length),0)
  await report.getByLabel('Stored report period start',{exact:true}).fill('2026-09-01');await report.getByLabel('Stored report period end',{exact:true}).fill('2026-09-30');await report.getByRole('button',{name:'Load stored report',exact:true}).click();await report.getByText(/25 shown · 26 matches · 26 total/).waitFor()
  assert.equal(await report.getByRole('button',{name:'Provider refresh unavailable',exact:true}).isDisabled(),true);assert.match(await report.textContent(),/Historical last successful sync: Unknown/);assert.match(await report.textContent(),/rate limited/)
  const shots=[];async function shot(name,node){await node.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const filename=`b6-stored-report-${name}-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,filename)});shots.push(filename)}
  await shot('status',report.getByRole('region',{name:'Current reporting status',exact:true}))
  await shot('observations',report.getByRole('article').nth(2));assert.match(await report.textContent(),/Completeness partial · freshness unknown/);assert.match(await report.textContent(),/Values withheld/)
  await report.getByRole('button',{name:'Next stored observations',exact:true}).click();await report.getByText(/1 shown · 26 matches · 26 total/).waitFor();await report.getByRole('button',{name:'Previous stored observations',exact:true}).click();await report.getByText(/25 shown · 26 matches · 26 total/).waitFor()
  const ids=await page.evaluate(()=>globalThis.__directChatPreview.reporting.observations.slice(0,2).map(r=>r.id));await report.getByLabel('Earlier stored observation',{exact:true}).selectOption(ids[0]);await report.getByLabel('Later stored observation',{exact:true}).selectOption(ids[1]);await report.getByRole('button',{name:'Compare exact observations',exact:true}).click();await report.getByRole('button',{name:'Review loaded rollup',exact:true}).click();assert.match(await report.textContent(),/Comparison unavailable: incomplete or unavailable/);assert.match(await report.textContent(),/not a project total/);await shot('comparison',report.getByText(/Comparison unavailable: incomplete or unavailable/))
  await report.getByLabel('Stored report metric key',{exact:true}).fill('no_metric');assert.equal(await report.getByRole('article').count(),0);await report.getByRole('button',{name:'Load stored report',exact:true}).click();await report.getByText(/0 shown · 0 matches · 26 total/).waitFor();await report.getByLabel('Stored report metric key',{exact:true}).fill('');await report.getByRole('button',{name:'Load stored report',exact:true}).click();await report.getByText(/25 shown · 26 matches · 26 total/).waitFor()
  await page.evaluate(()=>globalThis.__directChatPreview.reporting.setReportDenied(true));await report.getByRole('button',{name:'Load stored report',exact:true}).click();await report.getByRole('alert').filter({hasText:'resource access was revoked'}).waitFor();assert.equal(await report.getByRole('article').count(),0);await shot('revoked',report.getByRole('alert'))
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.reporting.calls.length),0);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(blocked,[]);results.push({width,height,theme,screenshots:shots,noReadsOnOpen:true,explicitBoundedPeriods:true,wholeTotalsPreserved:true,unknownNotZero:true,metricsWithheld:true,comparisonAndRollupNoFabrication:true,revocationClearsCachedReport:true,noProviderOrWrites:true,horizontalOverflow:false,pageErrors:errors,consoleErrors,blockedRemoteRequests:blocked});await context.close()
 }
 const evidence=path.join(output,'b2-service-native-evidence.json'),packet=JSON.parse(await fs.readFile(evidence,'utf8'));packet.storedReporting.ui={source:'tools/check-direct-chat-browser.cjs --stored-reporting',scope:'Actual Layout/theme, strictly serialized synthetic stored evidence only; no provider/resource/human acceptance',cases:results};await fs.writeFile(evidence,JSON.stringify(packet,null,2)+'\n');console.log(JSON.stringify({passed:results.length,evidence}))
}
async function campaignDeliverableAssertions(browser){
 const results=[]
 for(const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(15000);const errors=[],blocked=[],shots=[],warnings=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')warnings.push(message.text())});await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&u.port==='5188')return route.continue();blocked.push(u.origin);return route.abort()})
  await page.goto(`${base}?panel=campaign-planning&deliveryPlan=1&theme=${theme}`);await page.getByText('Campaign assets and calendar · Launch marketing',{exact:true}).click()
  const host=page.getByRole('region',{name:'Campaign assets and calendar',exact:true}),pane=page.getByRole('region',{name:'Campaign deliverable planning',exact:true}),f=await page.evaluate(()=>{const c=globalThis.__directChatPreview.campaign;return {campaignId:c.campaignId,planId:c.planId,serviceId:c.serviceId,rootId:c.deliveryRoot.id,versionId:c.deliveryVersion.id}})
  const click=name=>host.getByRole('button',{name,exact:true}).click(),choose=(name,value)=>host.getByLabel(name,{exact:true}).selectOption(value),fill=(name,value)=>host.getByLabel(name,{exact:true}).fill(value)
  const shot=async(region,name)=>{await region.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const file=`b5-delivery-${name}-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,file)});shots.push(file)}
  await click('Find campaigns');await choose('Exact campaign',f.campaignId);await click('Load exact plan versions');await choose('Exact campaign plan version',f.planId);await choose('Marketing service',f.serviceId)
  await fill('Find existing Project deliverables','Product launch article');await click('Load existing Project deliverables');await choose('Existing Project deliverable',f.rootId);await click('Load exact deliverable versions');await choose('Exact deliverable source version',f.versionId);await click('Load selected deliverable plan for editing');await fill('Deliverable topic','Reviewed product-team adoption');await click('Load existing delivery contributors');assert(await host.getByRole('button',{name:'Find campaigns',exact:true}).isDisabled());assert(await host.getByRole('button',{name:'Load outreach services',exact:true}).isDisabled());assert.equal(await pane.getByLabel('Planned version deadline',{exact:true}).inputValue(),'2026-10-12');await shot(pane.getByLabel('Private deliverable brief',{exact:true}),'editing')
  await click('Review private deliverable plan');assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.campaign.calls.length),0);await shot(page.getByRole('region',{name:'Review private deliverable plan',exact:true}),'review');await click('Confirm private deliverable plan');await pane.getByText('New unapproved canonical version and private planning saved. Reload the current deliverable head before another draft.',{exact:true}).waitFor();const saved=await page.evaluate(()=>{const f=globalThis.__directChatPreview.campaign,v=f.deliveryVersions[0],p=f.deliveryPlans.get(v.id);return {id:v.id,topic:p.input.topic,preview:v.preview_metadata,review:v.review_status,deadline:f.deliveryRoot.due_date}});assert.equal(saved.topic,'Reviewed product-team adoption');assert.deepEqual(saved.preview,{preview_url:'https://example.invalid/original-delivery-preview'});assert.equal(saved.review,'in_production');assert.equal(saved.deadline,'2026-10-10')
  await click('Reload current deliverable head');await click('Load exact deliverable versions');await choose('Exact deliverable source version',saved.id);await page.evaluate(()=>{const v=globalThis.__directChatPreview.campaign.deliveryVersions[0];v.title='Current canonical title';v.review_status='ready_for_client_review';v.state_version=3});await click('Read exact deliverable history');assert((await pane.textContent()).includes('current workflow: ready for client review'));assert((await pane.textContent()).includes('Canonical content changed'));await shot(page.getByRole('region',{name:'Exact deliverable planning history',exact:true}),'history')
  await page.evaluate(()=>{const f=globalThis.__directChatPreview.campaign,v=f.deliveryVersions[0];v.title=f.deliveryPlans.get(v.id).input.title;v.review_status='in_production';v.state_version=1;f.setDeliveryLost()});await click('Load selected deliverable plan for editing');await click('Review private deliverable plan');await click('Confirm private deliverable plan');await page.getByRole('region',{name:'Recover original deliverable operation',exact:true}).waitFor();assert(await pane.getByRole('button',{name:'Discard deliverable plan draft',exact:true}).isDisabled());const operation=await page.evaluate(()=>{const k=Object.keys(sessionStorage).find(k=>k.startsWith('anka:campaign-deliverable-operation:'));return JSON.parse(sessionStorage.getItem(k))});assert.deepEqual(Object.keys(operation),['requestId']);await shot(page.getByRole('region',{name:'Recover original deliverable operation',exact:true}),'recovery');await click('Check original deliverable operation');await pane.getByText('Recovered the original canonical version and private planning. No command was repeated.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.campaign.calls.length),2)
  assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);assert.deepEqual(blocked,[]);results.push({width,height,theme,screenshots:shots,canonicalFileAndClientPreviewUnchanged:true,privatePlanningExactVersion:true,currentApprovalSeparateFromOriginalPlanning:true,zeroWriteReview:true,uuidOnlyRecoveryNoRedispatch:true,syntheticConfirmationOnly:true,horizontalOverflow:false,pageErrors:errors,consoleErrors:warnings,blockedRemoteRequests:blocked});await context.close()
 }
 const evidence=path.join(output,'b2-service-native-evidence.json'),packet=JSON.parse(await fs.readFile(evidence,'utf8'));packet.campaignPlanning.deliverablePlans.ui={source:'tools/check-direct-chat-browser.cjs --campaign-deliverables',scope:'Actual Layout/theme, provider-free synthetic canonical source/file and private planning only; no production, provider or distinct-human approval acceptance',cases:results};await fs.writeFile(evidence,JSON.stringify(packet,null,2)+'\n');console.log(JSON.stringify({passed:results.length,evidence}))
}

async function marketingOpportunityAssertions(browser){
 const results=[]
 for(const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(15000);const errors=[],blocked=[],shots=[]
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&u.port==='5188')return route.continue();blocked.push(u.origin);return route.abort()})
  await page.goto(`${base}?panel=campaign-planning&opportunities=1&theme=${theme}`);await page.getByText('Campaign assets and calendar · Launch marketing',{exact:true}).click()
  const pane=page.getByRole('region',{name:'Project marketing opportunities',exact:true}),f=await page.evaluate(()=>{const c=globalThis.__directChatPreview.campaign;return {serviceId:c.serviceId,targetId:c.target.id,candidateId:c.candidate.id,observationId:c.observations[0].id,taskId:c.task.id}})
  const click=name=>pane.getByRole('button',{name,exact:true}).click(),choose=(name,value)=>pane.getByLabel(name,{exact:true}).selectOption(value),fill=(name,value)=>pane.getByLabel(name,{exact:true}).fill(value)
  const shot=async(region,name)=>{await region.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const file=`b5-outreach-${name}-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,file)});shots.push(file)}
  await click('Load outreach services');await choose('Outreach Marketing service',f.serviceId);await click('Load canonical outreach targets');await choose('Canonical outreach target',f.targetId);await fill('Research source URL','https://example.invalid/new-source');await fill('Research observation date UTC','2026-09-30');await fill('Research notes','Manual publication research; retain the source and observation date.');assert((await pane.textContent()).includes('authority Unknown · estimated traffic 0'));assert(await page.getByRole('button',{name:'Find campaigns',exact:true}).isDisabled());await shot(page.getByRole('region',{name:'Candidate research',exact:true}),'research')
  await click('Review research observation');assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.campaign.calls.length),0);await shot(page.getByRole('region',{name:'Review outreach operation',exact:true}),'review');await click('Confirm reviewed outreach operation');await pane.getByText('Research observation saved. It is not committed work.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.campaign.links.length),0)
  await click('Load outreach services');await choose('Outreach Marketing service',f.serviceId);await click('Load project research candidates');await choose('Exact research candidate',f.candidateId);await click('Load original research observations');await choose('Exact research observation',f.observationId);await click('Load existing Marketing Project Tasks');await choose('Existing Marketing Project Task',f.taskId);await click('Review governed Task link');assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.campaign.calls.length),1);await click('Confirm reviewed outreach operation');await pane.getByText('Existing Project Task linked. Its governance, owner and deadline remain in the Task workflow.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.campaign.links.length),1)
  await page.evaluate(()=>{const t=globalThis.__directChatPreview.campaign.task;t.due_date='2026-10-11';t.row_version=3});await click('Load project research candidates');await choose('Exact research candidate',f.candidateId);await click('Load original research observations');await click('Load original Task commitments');assert((await pane.textContent()).includes('due 2026-10-10'));assert((await pane.textContent()).includes('due 2026-10-11'));await shot(page.getByText('Original commitment:',{exact:false}),'history');await click('Discard outreach draft')
  await page.evaluate(()=>globalThis.__directChatPreview.campaign.setOpportunityLost());await click('Load outreach services');await choose('Outreach Marketing service',f.serviceId);await click('Load canonical outreach targets');await choose('Canonical outreach target',f.targetId);await fill('Research source URL','https://example.invalid/recovery-source');await fill('Research observation date UTC','2026-09-30');await click('Review research observation');await click('Confirm reviewed outreach operation');await page.getByRole('region',{name:'Recover original outreach operation',exact:true}).waitFor();assert(await pane.getByRole('button',{name:'Discard outreach draft',exact:true}).isDisabled());const operation=await page.evaluate(()=>{const k=Object.keys(sessionStorage).find(k=>k.startsWith('anka:marketing-opportunity-operation:'));return JSON.parse(sessionStorage.getItem(k))});assert.deepEqual(Object.keys(operation),['requestId']);await shot(page.getByRole('region',{name:'Recover original outreach operation',exact:true}),'recovery');await click('Check original outreach operation');await pane.getByText('Recovered the original operation. No command was repeated.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.campaign.calls.length),3)
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);results.push({width,height,theme,screenshots:shots,sourceDatePreserved:true,researchSeparateFromExistingTask:true,currentDriftSeparateFromOriginalHistory:true,zeroWriteReview:true,uuidOnlyRecoveryNoRedispatch:true,syntheticConfirmationOnly:true,horizontalOverflow:false,pageErrors:errors,blockedRemoteRequests:blocked});await context.close()
 }
 const evidence=path.join(output,'b2-service-native-evidence.json'),packet=JSON.parse(await fs.readFile(evidence,'utf8'));packet.marketingOpportunities.ui={source:'tools/check-direct-chat-browser.cjs --marketing-opportunities',scope:'Actual Layout/theme, provider-free synthetic source observations and existing Task links only; no production, provider or distinct-human acceptance',cases:results};await fs.writeFile(evidence,JSON.stringify(packet,null,2)+'\n');console.log(JSON.stringify({passed:results.length,evidence}))
}

async function campaignPlanAssertions(browser){
 const results=[]
 for(const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(15000);const errors=[],blocked=[],shots=[]
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&u.port==='5188')return route.continue();blocked.push(u.origin);return route.abort()})
  await page.goto(`${base}?panel=campaign-planning&planEditor=1&theme=${theme}`);await page.getByText('Campaign assets and calendar · Launch marketing',{exact:true}).click()
  const panel=page.getByRole('region',{name:'Campaign assets and calendar',exact:true}),editor=page.getByRole('region',{name:'Canonical campaign plan editor',exact:true}),f=await page.evaluate(()=>{const c=globalThis.__directChatPreview.campaign;return {campaignId:c.campaignId,planId:c.planId,serviceId:c.serviceId,actor:globalThis.__directChatPreview.fixture.scope.actorId||'a0000000-0000-4000-8000-000000000001',messageId:c.message.version_id,measurementId:c.measurement.version_id}})
  const click=name=>panel.getByRole('button',{name,exact:true}).click(),choose=(name,value)=>panel.getByLabel(name,{exact:true}).selectOption(value)
  const shot=async(region,name)=>{await region.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const file=`b5-campaign-plan-${name}-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,file)});shots.push(file)}
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.campaign.reads.length),0)
  await click('Find campaigns');await choose('Exact campaign',f.campaignId);await click('Load exact plan versions');await choose('Exact campaign plan version',f.planId);await choose('Marketing service',f.serviceId)
  await click('Load selected plan for editing');assert.equal(await editor.getByLabel('Planning budget',{exact:true}).inputValue(),'0');assert.equal(await editor.getByLabel('Creative format 1',{exact:true}).inputValue(),'Article');await shot(editor,'editing')
  await editor.getByLabel('Plan title',{exact:true}).fill('Reviewed launch plan');await click('Load campaign owners');const ownerId=await page.evaluate(()=>globalThis.__directChatPreview.campaign.repository.plans.candidates({kind:'owner'}).then(v=>v.items[0].id));await choose('Campaign owner',ownerId)
  await click('Load audience strategies');await editor.getByLabel('Strategy Approved product-team audience · v1',{exact:true}).check();await click('Load approved messages');await choose('Approved campaign message',f.messageId);await click('Load measurement plans');await choose('Approved measurement plan',f.measurementId)
  await click('Review canonical plan draft');const review=page.getByRole('region',{name:'Review canonical plan draft',exact:true});assert.match(await review.textContent(),/budget 0 USD/);assert.match(await review.textContent(),/Approved product-team audience · v1/);assert.match(await review.textContent(),/Creative 1: Article · Website blog · deadline 2026-10-10/);assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.campaign.calls.length),0);assert.equal(await panel.getByRole('button',{name:'Find campaigns',exact:true}).isDisabled(),true);await shot(review,'review')
  await page.evaluate(()=>globalThis.__directChatPreview.campaign.setLost());await review.getByRole('button',{name:'Confirm canonical plan draft',exact:true}).click();await page.getByRole('region',{name:'Recover original plan command',exact:true}).waitFor();const request=await page.evaluate(()=>globalThis.__directChatPreview.campaign.calls[0].requestId);const callsBefore=await page.evaluate(()=>globalThis.__directChatPreview.campaign.calls.length)
  await page.evaluate(()=>window.__originalPlanFixture=globalThis.__directChatPreview.campaign)
  // Remount the real scoped host through the fixture's request signal, preserving only its original UUID.
  await page.evaluate(()=>{globalThis.__directChatPreview.organization.requestSignal=new AbortController().signal;window.dispatchEvent(new Event('fixture-counters'))})
  await click('Check original plan operation');assert.match(await page.getByRole('region',{name:'Original saved campaign plan',exact:true}).textContent(),new RegExp(request));assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.campaign.calls.length),callsBefore);assert.equal(callsBefore,1);await shot(page.getByRole('region',{name:'Original saved campaign plan',exact:true}),'recovery')
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);results.push({width,height,theme,screenshots:shots,exactCanonicalSource:true,zeroBudgetRetained:true,reviewZeroWrite:true,originalUuidRecoveryNoRedispatch:true,syntheticConfirmationOnly:true,horizontalOverflow:false,pageErrors:errors,blockedRemoteRequests:blocked});await context.close()
 }
 const evidence=path.join(output,'b2-service-native-evidence.json'),packet=JSON.parse(await fs.readFile(evidence,'utf8'));packet.campaignPlanning.planCommands.ui={source:'tools/check-direct-chat-browser.cjs --campaign-plan',scope:'Actual Layout/theme and canonical editor; provider-free synthetic actors/receipts only, no distinct-human/provider/production acceptance',cases:results};await fs.writeFile(evidence,JSON.stringify(packet,null,2)+'\n');console.log(JSON.stringify({passed:results.length,evidence}))
}

async function campaignPlanningAssertions(browser){
 const results=[]
 for(const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],blocked=[],shots=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&u.port==='5188')return route.continue();blocked.push(u.origin);return route.abort()})
  await page.goto(`${base}?panel=campaign-planning&theme=${theme}`);await page.getByText('Campaign assets and calendar · Launch marketing',{exact:true}).click()
  const panel=page.getByRole('region',{name:'Campaign assets and calendar',exact:true}),f=await page.evaluate(()=>{const c=globalThis.__directChatPreview.campaign;return {campaignId:c.campaignId,planId:c.planId,serviceId:c.serviceId,assetId:c.assetId,variantId:c.variantId,workId:c.workId,variantVersion:c.variant.version_id}})
  const click=name=>panel.getByRole('button',{name,exact:true}).click(),choose=(name,value)=>panel.getByLabel(name,{exact:true}).selectOption(value),fill=(name,value)=>panel.getByLabel(name,{exact:true}).fill(value)
  const shot=async(region,name)=>{await region.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const file=`b5-campaign-${name}-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,file)});shots.push(file)}
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.campaign.reads.length),0)
  await click('Find campaigns');assert.match(await panel.textContent(),/1–25 of 26 matches/);await choose('Exact campaign',f.campaignId);await click('Load exact plan versions');assert.equal(await panel.getByLabel('Exact campaign plan version',{exact:true}).inputValue(),'');await choose('Exact campaign plan version',f.planId);await choose('Marketing service',f.serviceId)
  await click('Load shared assets');await choose('Original shared asset',f.assetId);await click('Find approved sources');await choose('Exact approved source version',f.variantVersion);await choose('Source registration','register_variant');await fill('Variant label','Short social variant');await click('Review source registration')
  const review=page.getByRole('region',{name:'Review exact campaign operation',exact:true});await review.waitFor();assert.match(await review.textContent(),/Original shared source: Approved product story · v1/);assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.campaign.calls.length),0);await shot(review,'source-review');await review.getByRole('button',{name:'Confirm campaign operation',exact:true}).click();await panel.getByText('Exact canonical source reference saved. Load shared assets to select it.',{exact:true}).waitFor()
  await click('Load shared assets');await choose('Original shared asset',f.assetId);await click('Load exact variants');await choose('Exact placement variant',f.variantId);await click('Find existing contributions');await choose('Existing canonical contribution',f.workId);await fill('Placement channel','Website');await fill('Schedule UTC instant','2026-10-10T09:00:00Z');await fill('Schedule IANA timezone','Asia/Karachi');await fill('Call to action','Read the product story');await choose('Placement record state','planned');await click('Review channel placement');assert.match(await review.textContent(),/No account is selected/);assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.campaign.calls.length),1);await shot(review,'placement-review');await review.getByRole('button',{name:'Confirm campaign operation',exact:true}).click();await panel.getByText('Placement revision saved. No publication or advertising spend was performed.',{exact:true}).waitFor()
  await choose('Placement mode','paid');await fill('Placement channel','Advertising');await choose('Placement record state','planned');await click('Review channel placement');await review.getByRole('button',{name:'Confirm campaign operation',exact:true}).click();await click('Load placement calendar')
  const calendar=page.getByRole('region',{name:'Current campaign placements',exact:true});await calendar.waitFor();assert.match(await calendar.textContent(),/Engagement Work Item: Canonical product story · due 2026-10-10/);assert.match(await calendar.textContent(),/Asia\/Karachi/);await choose('Calendar mode','paid');await click('Load placement calendar');assert.match(await calendar.textContent(),/1–1 of 1 matches · 3 total/);await shot(calendar,'calendar')
  await calendar.getByRole('button',{name:'Review pause',exact:true}).click();await review.getByRole('button',{name:'Confirm campaign operation',exact:true}).click();await click('Load placement calendar');await calendar.getByRole('button',{name:'Placement history',exact:true}).click();const history=page.getByRole('region',{name:'Exact placement history',exact:true});assert.match(await history.textContent(),/Revision 2 · paused/);assert.match(await history.textContent(),/Revision 1 · planned/);await shot(history,'history')
  const calls=await page.evaluate(()=>globalThis.__directChatPreview.campaign.calls);assert.equal(calls.length,4);assert.equal(calls[0].input.asset_id,f.assetId);assert.equal(calls[1].input.asset_id,calls[2].input.asset_id);assert.equal(calls[1].input.variant_id,calls[2].input.variant_id);assert.equal(calls[1].input.contribution.id,calls[2].input.contribution.id);assert.ok(calls.slice(1).every(row=>!('assignee_id' in row.input)));assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({viewport:{width,height},theme,screenshots:shots,zeroWriteReviews:true,oneSharedSourceAndExactVariant:true,organicPaidCanonicalWorkReuse:true,explicitUtcAndIanaTimezone:true,calendarFiltersWholeCounts:true,pausePreservesImmutableHistory:true,horizontalOverflow:false,pageErrors:errors,blockedRemoteRequests:blocked});await context.close()
 }
 const evidence=path.join(output,'b2-service-native-evidence.json'),packet=JSON.parse(await fs.readFile(evidence,'utf8'));packet.campaignPlacements.ui={source:'tools/check-direct-chat-browser.cjs --campaign-planning',scope:'Actual Layout/theme, provider-free synthetic fixture; no distinct-human/provider/production acceptance',cases:results};await fs.writeFile(evidence,JSON.stringify(packet,null,2)+'\n');console.log(JSON.stringify({passed:results.length,evidence}))
}

async function reportingBindingsAssertions(browser){
 const results=[]
 for(const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],blocked=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'&&url.port==='5188')return route.continue();blocked.push(url.origin);return route.abort()})
  await page.goto(`${base}?panel=reporting-bindings&theme=${theme}`)
  await page.getByText('Project reporting resources · Launch marketing',{exact:true}).click()
  const panel=page.getByRole('region',{name:'Project reporting resources',exact:true})
  await panel.getByRole('button',{name:'Find mapped resources',exact:true}).click()
  assert.match(await panel.textContent(),/1–25 of 26 matches/)
  const key=await page.evaluate(()=>{const r=globalThis.__directChatPreview.reporting.candidates[1];return JSON.stringify([r.connection_id,r.resource_kind,r.resource_key])})
  await panel.getByLabel('Mapped reporting resource',{exact:true}).selectOption(key)
  await panel.getByRole('button',{name:'Review reporting binding',exact:true}).click()
  const review=page.getByRole('region',{name:'Review exact reporting binding',exact:true});await review.waitFor();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.reporting.calls.length),0)
  await review.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  const reviewShot=`b2-reporting-resource-review-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,reviewShot)})
  await review.getByRole('button',{name:'Confirm reporting binding',exact:true}).click();await panel.getByText('Reporting binding revision saved. Provider verification is still required before reporting.',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.reporting.calls.length),1)
  await panel.getByRole('button',{name:'Load project bindings',exact:true}).click()
  let meta=panel.getByRole('article').filter({hasText:'Facebook page'});assert.match(await meta.textContent(),/Observed reporting permission is missing/)
  await meta.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  const pendingShot=`b2-reporting-resource-pending-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,pendingShot)})
  for(const state of ['paused','revoked']){
   meta=panel.getByRole('article').filter({hasText:'Facebook page'});await meta.getByRole('button',{name:'Review binding',exact:true}).click()
   await panel.getByLabel('Reporting binding state',{exact:true}).selectOption(state)
   await panel.getByRole('button',{name:'Review reporting binding',exact:true}).click()
   await page.getByRole('region',{name:'Review exact reporting binding',exact:true}).getByRole('button',{name:'Confirm reporting binding',exact:true}).click()
   await panel.getByText('Reporting binding revision saved. Provider verification is still required before reporting.',{exact:true}).waitFor();await panel.getByRole('button',{name:'Load project bindings',exact:true}).click()
  }
  meta=panel.getByRole('article').filter({hasText:'Facebook page'});assert.match(await meta.textContent(),/Reporting is revoked/);await meta.getByRole('button',{name:'Binding history',exact:true}).click()
  const history=panel.getByRole('region',{name:'Reporting binding history',exact:true});await history.waitFor();assert.match(await history.textContent(),/3 revisions/);assert.match(await history.textContent(),/Revision 1 · enabled/);await history.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  const historyShot=`b2-reporting-resource-history-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,historyShot)})
  const calls=await page.evaluate(()=>globalThis.__directChatPreview.reporting.calls);assert.equal(calls.length,3);assert.equal(calls[1].input.binding_id,calls[2].input.binding_id);assert.equal(calls[1].input.expected_revision,1);assert.equal(calls[2].input.expected_revision,2);assert.ok(calls.every(value=>JSON.stringify(value.input.permitted_operations)==='["reporting_read"]'))
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);results.push({viewport:{width,height},theme,screenshots:[reviewShot,pendingShot,historyShot],reviewZeroWrites:true,oneReviewedNewBinding:true,explicitPauseRevoke:true,originalRevisionHistory:true,metaObservedGrantPending:true,reportingOnly:true,horizontalOverflow:false,pageErrors:errors,blockedRemoteRequests:blocked});await context.close()
 }
 const evidence=path.join(output,'b2-service-native-evidence.json'),packet=JSON.parse(await fs.readFile(evidence,'utf8'));packet.projectResources.ui={source:'tools/check-direct-chat-browser.cjs --reporting-bindings',scope:'Actual Layout, provider-free synthetic fixture; no real OAuth/provider/human acceptance',cases:results};await fs.writeFile(evidence,JSON.stringify(packet,null,2)+'\n');console.log(JSON.stringify({passed:results.length,evidence}))
}
async function drawerAssertions(page, label, opener) {
  const drawer = page.getByRole('dialog', { name: label, exact: true })
  await drawer.waitFor()
  assert.equal(await drawer.getAttribute('aria-modal'), 'true')
  const focusables = await drawer.locator('button, input, select, textarea, a[href]').evaluateAll(nodes => nodes.filter(node => !node.disabled && node.getClientRects().length).map(node => node.textContent || node.getAttribute('aria-label')))
  assert(focusables.length > 0)
  assert(await drawer.evaluate(node => node.contains(document.activeElement)))
  await page.keyboard.press('Shift+Tab')
  assert(await drawer.evaluate(node => node.contains(document.activeElement)), 'Shift Tab escaped the modal')
  await page.keyboard.press('Tab')
  assert(await drawer.evaluate(node => node.contains(document.activeElement)), 'Tab escaped the modal')
  await page.keyboard.press('Escape')
  assert.equal(await drawer.count(), 0)
  assert(await opener.evaluate(node => document.activeElement === node), 'Escape did not restore opener focus')
  return { initialFocus: true, shiftTabContained: true, tabContained: true, escapeClosed: true, openerFocusRestored: true }
}
async function websiteSiteFindingsAssertions(browser){
 const results=[]
 for(const [width,theme] of [[1440,'light'],[390,'dark']]){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme}),page=await context.newPage(),errors=[],blocked=[];page.setDefaultTimeout(15000)
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&u.port==='5188')return route.continue();blocked.push(u.origin);return route.abort()})
  await page.goto(`${base}?panel=website-pages&siteFindings=1&theme=${theme}`);await page.getByRole('button',{name:'Find approved architectures',exact:true}).click();const version=await page.evaluate(()=>globalThis.__directChatPreview.website.versionId);await page.getByLabel('Website approved architecture',{exact:true}).selectOption(version)
  const panel=page.getByRole('region',{name:'Website site findings',exact:true}),screenshots=[];assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.siteFindingsRepository.calls.length),0)
  await panel.getByRole('button',{name:'Load site findings',exact:true}).click();await panel.getByText('1–25 of 26 findings · 26 total',{exact:true}).waitFor();assert.match(await panel.textContent(),/Planned pages101/);assert.match(await panel.textContent(),/Registered pages2/);assert.match(await panel.textContent(),/Pages with manual checks2/);assert.match(await panel.textContent(),/Registered pages without checks0/)
  async function capture(kind,locator){await locator.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const filename=`b4-website-site-findings-${kind}-${theme}-${width}x900.png`;await page.screenshot({path:path.join(output,filename)});screenshots.push(filename)}
  await capture('overview',panel.getByRole('heading',{name:'Site findings · manual page evidence',exact:true}));await panel.getByRole('button',{name:'Next site findings',exact:true}).click();await panel.getByText('26–26 of 26 findings · 26 total',{exact:true}).waitFor();assert.match(await panel.textContent(),/Service page 2/);await capture('page',panel.locator('article').first())
  await panel.getByRole('button',{name:'Previous site findings',exact:true}).click();await panel.getByRole('button',{name:'Open page evidence',exact:true}).first().click();const seo=page.getByRole('region',{name:'Website page SEO observations',exact:true});await seo.getByRole('heading',{name:'SEO observations · Welcome',exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.seoRepository.calls.length),0)
  await seo.getByRole('button',{name:'Load manual check history',exact:true}).click();const history=seo.getByRole('region',{name:'Manual page check history',exact:true});await history.getByText('Retained manual site findings in the original page history',{exact:true}).waitFor();assert.match(await history.textContent(),/Manual finding 1/);assert.match(await history.textContent(),/Implementation changed/);await capture('history',history.locator('article').first());await seo.getByRole('button',{name:'Close SEO observations',exact:true}).click()
  await panel.getByLabel('Site finding search',{exact:true}).fill('no matching finding');await panel.getByRole('button',{name:'Load site findings',exact:true}).click();await panel.getByText('No manual findings match this view. Missing provider measurements remain unknown.',{exact:true}).waitFor();await panel.getByLabel('Site finding search',{exact:true}).fill('');await page.evaluate(()=>globalThis.__directChatPreview.website.siteFindingsRepository.setUnavailable());await panel.getByRole('button',{name:'Load site findings',exact:true}).click();await panel.getByText('Unknown',{exact:true}).waitFor();assert.match(await panel.textContent(),/Retained manual findings remain visible/)
  const stats=await page.evaluate(()=>({pageWrites:globalThis.__directChatPreview.website.calls.length,checkWrites:globalThis.__directChatPreview.website.versionChecksRepository.calls.filter(c=>c.kind==='confirm').length,overflow:document.documentElement.scrollWidth>innerWidth}));assert.deepEqual(stats,{pageWrites:0,checkWrites:0,overflow:false});assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({theme,viewport:{width,height:900},zeroInitialReads:true,coverageCountersIndependent:true,boundedPagination:true,canonicalPageAndOriginalCheckDrillDown:true,retainedHistoryConsistent:true,emptyFilterAndUnavailableSourceDistinct:true,noProviderRequestsOrWrites:true,noHorizontalOverflow:true,pageErrors:errors,blockedRemoteRequests:blocked,screenshots});await context.close()
 }
 const packet=path.join(output,'b2-service-native-evidence.json'),evidence=JSON.parse(await fs.readFile(packet,'utf8'));evidence.pageIdentity.siteFindings.browser={source:'tools/check-direct-chat-browser.cjs --website-site-findings',scope:'Actual site/manual-page-history views in shared Layout; common synthetic page/check fixtures; no human/provider/production acceptance',results};await fs.writeFile(packet,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({websiteSiteFindingsPassed:results.length,evidence:packet}))
}

async function websiteManualCheckAssertions(browser){
 const results=[]
 for(const [width,theme] of [[1440,'light'],[390,'dark']]){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme}),page=await context.newPage(),errors=[],blocked=[];page.setDefaultTimeout(15000)
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&u.port==='5188')return route.continue();blocked.push(u.origin);return route.abort()})
  await page.goto(`${base}?panel=website-pages&theme=${theme}`);await page.getByRole('button',{name:'Find approved architectures',exact:true}).click();const version=await page.evaluate(()=>globalThis.__directChatPreview.website.versionId);await page.getByLabel('Website approved architecture',{exact:true}).selectOption(version);await page.getByRole('button',{name:'SEO observations',exact:true}).first().click()
  const panel=page.getByRole('region',{name:'Version-bound manual page checks',exact:true}),screenshots=[];assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.versionChecksRepository.calls.length),0)
  await panel.getByLabel('Manual check observation time',{exact:true}).fill('2026-01-01T09:00');await panel.getByLabel('Manual check Schema valid',{exact:true}).selectOption('false');await panel.getByLabel('Manual check Mobile score',{exact:true}).fill('0');await panel.getByLabel('Manual check evidence notes',{exact:true}).fill('Manual inspector checked structured data. This records evidence, not provider verification.');await panel.getByRole('button',{name:'Add manual finding',exact:true}).click();await panel.getByLabel('Manual finding 1 category',{exact:true}).selectOption('schema');await panel.getByLabel('Manual finding 1 description',{exact:true}).fill('Missing structured data');await panel.getByLabel('Manual finding 1 evidence',{exact:true}).fill('Manual inspector panel')
  assert.equal(await page.getByLabel('Website approved architecture',{exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Close SEO observations',exact:true}).isDisabled(),true)
  await panel.getByRole('button',{name:'Review manual check',exact:true}).click();const review=panel.getByRole('region',{name:'Exact manual check review',exact:true});await review.waitFor();assert.match(await review.textContent(),/indexed Unknown · schema valid No · mobile 0 · desktop Unknown/);assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.versionChecksRepository.calls.filter(c=>c.kind==='confirm').length),0)
  async function capture(kind,locator){await locator.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const name=`b4-website-manual-check-${kind}-${theme}-${width}x900.png`;await page.screenshot({path:path.join(output,name)});screenshots.push(name)}
  await capture('review',review);await review.getByRole('button',{name:'Confirm manual check',exact:true}).click();await panel.getByText('Manual check saved with its original evidence and exact page version.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.versionChecksRepository.checks.length),1)
  await panel.getByRole('button',{name:'Load manual check history',exact:true}).click();const history=panel.getByRole('region',{name:'Manual page check history',exact:true});await history.getByText(/^Current manual evidence/).waitFor();await page.evaluate(()=>globalThis.__directChatPreview.website.versionChecksRepository.setChanged());await panel.getByRole('button',{name:'Load manual check history',exact:true}).click();await history.getByText('Implementation changed.',{exact:true}).waitFor();await capture('history',history)
  await panel.getByLabel('Manual check observation time',{exact:true}).fill('2026-01-01T10:00');await panel.getByLabel('Manual check evidence notes',{exact:true}).fill('Second manual observation with original UUID recovery');await page.evaluate(()=>globalThis.__directChatPreview.website.versionChecksRepository.setLost());await panel.getByRole('button',{name:'Review manual check',exact:true}).click();await panel.getByRole('button',{name:'Confirm manual check',exact:true}).click();const pending=panel.getByRole('status').filter({hasText:/New commands stay blocked/});await pending.waitFor();assert.equal(await panel.getByRole('button',{name:'Discard manual draft',exact:true}).isDisabled(),true);await capture('recovery',pending);await panel.getByRole('button',{name:'Check original manual operation',exact:true}).click();await panel.getByText('Recovered the original manual check. No repeated write.',{exact:true}).waitFor()
  const stats=await page.evaluate(()=>({confirm:globalThis.__directChatPreview.website.versionChecksRepository.calls.filter(c=>c.kind==='confirm').length,otherWrites:globalThis.__directChatPreview.website.calls.length,storage:sessionStorage.length,overflow:document.documentElement.scrollWidth>innerWidth}));assert.deepEqual(stats,{confirm:2,otherWrites:0,storage:0,overflow:false});assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({theme,viewport:{width,height:900},zeroInitialReads:true,draftNavigationGuard:true,zeroWriteExactReview:true,manualZeroFalseUnknownPreserved:true,typedPageFindings:true,oneOriginalReceiptPerConfirmation:true,laterImplementationRecheck:true,unknownOutcomeFreezesCommands:true,uuidOnlyRecoveryWithoutRepeatedWrite:true,noProviderRequests:true,noHorizontalOverflow:true,pageErrors:errors,blockedRemoteRequests:blocked,screenshots});await context.close()
 }
 const packet=path.join(output,'b2-service-native-evidence.json'),evidence=JSON.parse(await fs.readFile(packet,'utf8'));evidence.pageIdentity.versionChecks.browser={source:'tools/check-direct-chat-browser.cjs --website-manual-check',scope:'Actual manual page-check editor in shared Layout; synthetic local fixture only; real manual/provider/human acceptance remains pending',results};await fs.writeFile(packet,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({websiteManualChecksPassed:results.length,evidence:packet}))
}

async function websiteSeoAssertions(browser){
 const results=[]
 for(const [width,theme] of [[1440,'light'],[390,'dark']]){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme}),page=await context.newPage(),errors=[],blocked=[]
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&u.port==='5188')return route.continue();blocked.push(u.origin);return route.abort()})
  await page.goto(`${base}?panel=website-pages&theme=${theme}`)
  await page.getByRole('button',{name:'Find approved architectures',exact:true}).click()
  const version=await page.evaluate(()=>globalThis.__directChatPreview.website.versionId)
  await page.getByLabel('Website approved architecture',{exact:true}).selectOption(version)
  await page.getByRole('button',{name:'SEO observations',exact:true}).first().click()
  const panel=page.getByRole('region',{name:'Website page SEO observations',exact:true})
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.seoRepository.calls.length),0)
  await panel.getByRole('button',{name:'Load stored SEO evidence',exact:true}).click()
  await panel.getByText(/Mobile score: 0/).waitFor();assert.match(await panel.textContent(),/schema valid: false/);assert.match(await panel.textContent(),/Indexed: Unknown/)
  const screenshots=[]
  async function capture(kind){await panel.getByRole('region',{name:'Stored SEO records',exact:true}).scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const filename=`b4-website-seo-${kind}-${theme}-${width}x900.png`;await page.screenshot({path:path.join(output,filename)});screenshots.push(filename)}
  await capture('manual')
  await panel.getByLabel('SEO evidence category',{exact:true}).selectOption('planned_targets');await panel.getByRole('button',{name:'Load stored SEO evidence',exact:true}).click();await panel.getByText('1–25 of 26 matches · 26 total',{exact:true}).waitFor();assert.doesNotMatch(await panel.textContent(),/Position:/)
  await panel.getByRole('button',{name:'Next SEO evidence',exact:true}).click();await panel.getByText('26–26 of 26 matches · 26 total',{exact:true}).waitFor();await capture('targets')
  await panel.getByLabel('SEO evidence category',{exact:true}).selectOption('query_observations');await panel.getByRole('button',{name:'Find existing GSC bindings',exact:true}).click();const binding=await page.evaluate(()=>globalThis.__directChatPreview.website.seoRepository.bindingId);await panel.getByLabel('SEO project GSC binding',{exact:true}).selectOption(binding);await panel.getByRole('button',{name:'Load stored SEO evidence',exact:true}).click();await panel.getByText('Position: Unknown · clicks: Unknown · impressions: Unknown',{exact:true}).first().waitFor();assert.match(await panel.textContent(),/historical resource is unknown/);assert.match(await panel.textContent(),/Selected resource access still needs provider verification/);await capture('queries')
  await page.evaluate(()=>globalThis.__directChatPreview.website.seoRepository.setRevoked());await panel.getByRole('button',{name:'Load stored SEO evidence',exact:true}).click();await panel.getByText('The current resource mapping or authorization is unavailable.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.calls.length),0);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({theme,viewport:{width,height:900},explicitLoadZeroInitialReads:true,manualZeroFalseUnknownPreserved:true,targetsAndObservationsSeparate:true,boundedPagination:true,legacyProviderValuesWithheld:true,currentMappingRechecked:true,noProviderRequestsOrWrites:true,noHorizontalOverflow:true,pageErrors:errors,blockedRemoteRequests:blocked,screenshots});await context.close()
 }
 const packet=path.join(output,'b2-service-native-evidence.json'),evidence=JSON.parse(await fs.readFile(packet,'utf8'));evidence.pageIdentity.seoObservationReads.browser={source:'tools/check-direct-chat-browser.cjs --website-seo',scope:'Actual page-scoped SEO view in shared Layout; synthetic local fixture; provider and human acceptance pending',results};await fs.writeFile(packet,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({websiteSeoPassed:results.length,evidence:packet}))
}

async function websiteEditorAssertions(browser){
 const results=[]
 for(const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],blocked=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1' && url.port==='5188')return route.continue();blocked.push(url.origin);return route.abort()})
  await page.goto(`${base}?panel=website-pages&theme=${theme}`)
  await page.getByRole('button',{name:'Find approved architectures',exact:true}).click()
  const version=await page.evaluate(()=>globalThis.__directChatPreview.website.versionId)
  await page.getByLabel('Website approved architecture',{exact:true}).selectOption(version)
  await page.getByRole('button',{name:'Edit page',exact:true}).click()
  const editor=page.getByRole('region',{name:'Website page editor',exact:true})
  await editor.getByText('Approved structure · exact v2',{exact:true}).click()
  assert.match(await editor.getByLabel('Exact approved page structure',{exact:true}).textContent(),/Approved hero/);assert.match(await editor.textContent(),/original \/home/);assert.match(await editor.textContent(),/deadline: 2026-10-10/)
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.calls.length),0)
  await editor.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  const structure=`b4-website-editor-structure-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,structure)})
  await editor.getByText('Approved structure · exact v2',{exact:true}).click()
  await editor.getByLabel('Website page publication state',{exact:true}).selectOption('in_progress')
  await editor.getByLabel('Implementation notes',{exact:true}).fill('Implement approved hero, call to action and canonical source references.')
  await editor.getByLabel('QA evidence',{exact:true}).fill('Desktop and mobile review complete. Original live URL and redirect retained.')
  await editor.getByRole('button',{name:'Review page change',exact:true}).click()
  const review=editor.getByRole('region',{name:'Review Website page change',exact:true});await review.waitFor();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.calls.length),0)
  await review.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  const implementation=`b4-website-editor-review-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,implementation)})
  await review.getByRole('button',{name:'Confirm page change',exact:true}).click();await page.getByText('Page implementation revision saved. Canonical work and original path are preserved.',{exact:true}).waitFor()
  const saved=await page.evaluate(()=>globalThis.__directChatPreview.website.calls[0]);assert.equal(saved.command_kind,'save_operations');assert.equal(saved.expectedRevision,2);assert.equal(saved.architectureVersionId,version);assert.equal(saved.operations.publication_state,'in_progress');assert.equal(saved.operations.recorded_live_url,'https://example.invalid/home');assert.equal(saved.operations.redirect_url,'https://example.invalid/welcome');assert.equal('assignee_id' in saved.operations,false)
  await page.getByRole('button',{name:'Edit page',exact:true}).click();await editor.getByLabel('Website edit category',{exact:true}).selectOption('seo')
  await editor.getByLabel('Website SEO observation page',{exact:true}).selectOption('a0000000-0000-4000-8000-000000000210');await editor.getByRole('button',{name:'Review page change',exact:true}).click()
  await editor.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.calls.length),1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  const seo=`b4-website-editor-seo-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,seo)})
  await editor.getByRole('button',{name:'Confirm page change',exact:true}).click();await page.getByText('Explicit SEO observation link saved. Historical links are preserved.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Edit page',exact:true}).click();await editor.getByLabel('Website edit category',{exact:true}).selectOption('seo');await editor.getByLabel('Website SEO observation page',{exact:true}).selectOption('');await editor.getByRole('button',{name:'Review page change',exact:true}).click();await editor.getByRole('button',{name:'Confirm page change',exact:true}).click()
  await page.getByRole('button',{name:'History',exact:true}).click();const history=page.getByRole('region',{name:'Website page history',exact:true});assert.match(await history.textContent(),/Revision 3 · \/welcome/);assert.match(await history.textContent(),/Original path: \/home/);assert.match(await history.textContent(),/3 immutable SEO link events/)
  const calls=await page.evaluate(()=>globalThis.__directChatPreview.website.calls);assert.equal(calls.length,3);assert.deepEqual(calls.slice(1).map(row=>[row.command_kind,row.expectedLinkNumber,row.trackedPageId]),[['link_seo',1,'a0000000-0000-4000-8000-000000000210'],['link_seo',2,null]])
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({theme,viewport:{width,height},exactCanonicalV2Structure:true,derivedOwnerDeadline:true,zeroWriteReviews:true,oneNamedImplementationCommand:true,explicitSeoLinkAndUnlink:true,originalPathAndImmutableHistory:true,noHorizontalOverflow:true,pageErrors:errors,blockedRemoteRequests:blocked,screenshots:[structure,implementation,seo]});await context.close()
 }
 const packetPath=path.join(output,'b2-service-native-evidence.json'),packet=JSON.parse(await fs.readFile(packetPath,'utf8'));packet.pageIdentity.editorUi={...(packet.pageIdentity.editorUi||{}),browser:{source:'tools/check-direct-chat-browser.cjs --website-editor',scope:'Actual Website editor in shared Layout/theme; isolated synthetic approved source; no production/provider or human acceptance',results}};await fs.writeFile(packetPath,JSON.stringify(packet,null,2)+'\n');console.log(JSON.stringify({passed:results.length,evidence:packetPath}))
}

async function websitePageAssertions(browser){
 const results=[]
 for(const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],blocked=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1' && url.port==='5188')return route.continue();blocked.push(url.origin);return route.abort()})
  await page.goto(`${base}?panel=website-pages&theme=${theme}`)
  await page.getByRole('button',{name:'Find approved architectures',exact:true}).click()
  const version=await page.evaluate(()=>globalThis.__directChatPreview.website.versionId)
  await page.getByRole('combobox',{name:'Website approved architecture',exact:true}).selectOption(version)
  await page.getByText('1–25 of 101 matching pages',{exact:true}).waitFor()
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Website view overflows the screen')
  const overview=`b4-website-pages-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,overview)})
  await page.getByRole('button',{name:'Next pages',exact:true}).click();await page.getByText('26–50 of 101 matching pages',{exact:true}).waitFor()
  await page.getByRole('combobox',{name:'Website publication filter',exact:true}).selectOption('published');await page.getByText('1–1 of 1 matching pages',{exact:true}).waitFor()
  await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('region',{name:'Website page history',exact:true}).getByText('Original path: /home',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.calls.length),0)
  await page.getByRole('button',{name:'Close history',exact:true}).click()
  await page.getByRole('button',{name:'Review all 101 pages',exact:true}).click()
  const review=page.getByRole('region',{name:'Review Website page registration',exact:true});await review.getByRole('heading',{name:'Review 101 exact page identities',exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.website.calls.length),0)
  const confirm=review.getByRole('button',{name:'Confirm page identities',exact:true});await confirm.scrollIntoViewIfNeeded()
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  const reviewed=`b4-website-registration-review-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,reviewed)})
  await confirm.click();await page.getByText('101 page identities confirmed. Canonical work and assignments are preserved.',{exact:true}).waitFor()
  const writes=await page.evaluate(()=>({count:globalThis.__directChatPreview.website.calls.length,size:globalThis.__directChatPreview.website.calls[0].pageKeys.length,firstOriginalPath:globalThis.__directChatPreview.website.rows[0].initial_path}))
  assert.deepEqual(writes,{count:1,size:101,firstOriginalPath:'home'});assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({theme,viewport:{width,height},sourcePages:101,boundedPaging:true,statusFilterKeepsWholeCounts:true,immutableRenameHistory:true,reviewZeroWrites:true,oneAtomic101PageConfirmation:true,noHorizontalOverflow:true,pageErrors:errors,blockedRemoteRequests:blocked,screenshots:[overview,reviewed]});await context.close()
 }
 const packetPath=path.join(output,'b2-service-native-evidence.json'),packet=JSON.parse(await fs.readFile(packetPath,'utf8'));packet.pageIdentity.ui={...(packet.pageIdentity.ui||{}),browser:{source:'tools/check-direct-chat-browser.cjs --website-pages',scope:'Actual Layout/theme with isolated synthetic approved source; no production/provider or human acceptance',results}};await fs.writeFile(packetPath,JSON.stringify(packet,null,2)+'\n');console.log(JSON.stringify({passed:results.length,evidence:packetPath}))
}

async function writerAssertions(browser) {
  const results = []
  const recoveryOnly = process.argv.includes('--writer-recovery')
  for (const [width, height, theme] of (recoveryOnly ? [[1440,900,'dark']] : [[1440,900,'light'],[1440,900,'dark'],[390,900,'light'],[390,900,'dark']])) {
    const context = await browser.newContext({ viewport: { width, height } })
    const page = await context.newPage(); page.setDefaultTimeout(15000)
    const errors = [], blocked = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('dialog', dialog => dialog.accept())
    await page.route('**/*', route => { const url = new URL(route.request().url()); if (url.hostname === '127.0.0.1' && url.port === '5188') return route.continue(); blocked.push(url.origin); return route.abort() })
    await page.goto(`${base}?panel=writer&surface=content&state=empty&theme=${theme}`)
    const chatComposer = page.getByRole('textbox', { name: /^Message/ })
    await chatComposer.waitFor()
    const composerBounds = await chatComposer.boundingBox()
    assert(composerBounds && composerBounds.y >= 0 && composerBounds.y + composerBounds.height <= height, 'Shared engagement composer extends below viewport')
    assert(await page.locator('.department-chat-messages').evaluate(node => node.getBoundingClientRect().height >= 80))
    await chatComposer.fill('Keep this unsent engagement message')
    await page.getByRole('button', { name: 'Open Content writer beside chat', exact: true }).click()
    const pane = page.getByRole(width <= 900 ? 'dialog' : 'complementary', { name: 'Canonical Content side editor', exact: true })
    await pane.getByRole('heading', { name: 'Content writer · canonical versions', exact: true }).waitFor()
    assert(await pane.evaluate(node => node.contains(document.activeElement)))
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const draftBounds = await pane.getByLabel(/Draft text/).boundingBox()
    assert(draftBounds && draftBounds.y >= 0 && draftBounds.y + 40 < height, 'Editable text not visible on opening')
    assert(await pane.getByRole('button', { name: 'Back to chat', exact: true }).isVisible())
    const openScreenshot = `b3-content-writer-open-${theme}-${width}x${height}.png`
    if (!recoveryOnly) await page.screenshot({ path: path.join(output, openScreenshot) })
    await pane.getByRole('combobox', { name: 'Saved writer output', exact: true }).selectOption({ label: 'Existing article · v1' })
    const body = pane.getByLabel(/Draft text/)
    assert.equal(await body.inputValue(), 'Keep alpha and omega.')
    await body.evaluate(node => { node.focus(); node.setSelectionRange(5,10) })
    await pane.getByRole('button', { name: 'Use selected text', exact: true }).click()
    await pane.getByLabel(/Replacement/).fill('beta')
    await pane.getByRole('button', { name: 'Apply to working draft', exact: true }).click()
    assert.equal(await body.inputValue(), 'Keep beta and omega.')
    assert.equal(await page.evaluate(() => globalThis.__directChatPreview.fixture.writerWrites), 0)
    await pane.getByRole('button', { name: 'Preview draft', exact: true }).click()
    const saveScreenshot = `b3-content-writer-save-preview-${theme}-${width}x${height}.png`
    await pane.getByRole('button', { name: 'Confirm unapproved draft', exact: true }).scrollIntoViewIfNeeded()
    if (!recoveryOnly) await page.screenshot({ path: path.join(output, saveScreenshot) })
    await pane.getByRole('button', { name: 'Confirm unapproved draft', exact: true }).click()
    await page.waitForFunction(() => globalThis.__directChatPreview.fixture.writerWrites === 1)
    const canonical = await page.evaluate(() => ({ writes: globalThis.__directChatPreview.fixture.writerWrites, versions: globalThis.__directChatPreview.fixture.contentWorkspace.versions.map(version => ({ id: version.id, parent: version.parent_version_id, number: version.version_number, body: version.content.body })) }))
    assert.equal(canonical.versions.length, 2)
    assert.equal(canonical.versions[0].body, 'Keep alpha and omega.')
    assert.equal(canonical.versions[1].parent, canonical.versions[0].id)
    assert.equal(canonical.versions[1].body, 'Keep beta and omega.')
    assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
    results.push({ viewport: { width, height }, theme, focusMovedToPane: true, editableTextVisibleOnOpen: true, persistentReturnControl: true, noHorizontalOverflow: true, boundedReplacementPreservesOtherText: true, previewDoesNotWrite: true, oneExactParentImmutableSave: true, sourceVersionUnchanged: true, writerWrites: canonical.writes, pageErrors: errors, blockedRemoteRequests: blocked, screenshots: [openScreenshot, saveScreenshot] })
    await page.waitForFunction(() => document.querySelector('.content-chat-writer textarea')?.value === '')
    if (recoveryOnly) {
      await pane.getByRole('combobox', { name: 'Saved writer output', exact: true }).selectOption({ label: 'Existing article · v2' })
      await body.fill('Keep gamma and omega.')
      await page.evaluate(() => { globalThis.__directChatPreview.fixture.writerUncertainAfterSave = true })
      await pane.getByRole('button', { name: 'Preview draft', exact: true }).click()
      await pane.getByRole('button', { name: 'Confirm unapproved draft', exact: true }).click()
      await pane.getByText('The save outcome needs review.', { exact: false }).waitFor()
      assert(await pane.getByRole('button', { name: 'Confirm unapproved draft', exact: true }).isDisabled())
      assert.equal(await page.evaluate(() => globalThis.__directChatPreview.fixture.writerWrites), 2)
      await pane.getByText('Saved versions and copy options', { exact: true }).click()
      await pane.getByRole('button', { name: 'Refresh outputs', exact: true }).click()
      await pane.getByRole('button', { name: 'Continue from exact v3', exact: true }).waitFor()
      await pane.getByRole('button', { name: 'Back to chat', exact: true }).click()
      assert.equal(await chatComposer.inputValue(), 'Keep this unsent engagement message')
      await page.getByRole('button', { name: 'Open Content writer beside chat', exact: true }).click()
      await pane.getByRole('combobox', { name: 'Saved writer output', exact: true }).selectOption({ label: 'Existing article · v3' })
      assert.equal(await pane.getByLabel(/Draft text/).inputValue(), 'Keep gamma and omega.')
      assert.equal(await page.evaluate(() => globalThis.__directChatPreview.fixture.writerWrites), 2)
      results.at(-1).uncertainSaveRecovery = { committedVersionInspected: true, blindRetryBlocked: true, twoIntentionalWrites: true, editorReopenedAtExactLatest: true, chatDraftPreserved: true }
    }
    if (width <= 900) results.at(-1).editorDrawer = await drawerAssertions(page, 'Canonical Content side editor', page.getByRole('button', { name: 'Open Content writer beside chat', exact: true }))
    if (width > 900) await pane.getByRole('button', { name: 'Back to chat', exact: true }).click()
    assert.equal(await chatComposer.inputValue(), 'Keep this unsent engagement message')
    results.at(-1).actualEngagementComposerPreserved = true
    results.at(-1).sharedChatComposerWithinViewport = true
    await context.close()
    console.log('VERIFY canonical writer', width, height, theme)
  }
  if (recoveryOnly) {
    const file = path.join(output, 'b3-content-writer-browser-evidence.json')
    const existing = JSON.parse(await fs.readFile(file, 'utf8')); existing.recoveryResults = results; await fs.writeFile(file, JSON.stringify(existing, null, 2))
  } else {
  const file = path.join(output, 'b3-content-writer-browser-evidence.json')
  let existing = {}; try { existing = JSON.parse(await fs.readFile(file, 'utf8')) } catch { /* First evidence write. */ }
  await fs.writeFile(file, JSON.stringify({ ...existing, source: 'tools/check-direct-chat-browser.cjs --writer', scope: 'Actual engagement Chat and canonical side writer/shell; isolated backend metadata and canonical save fixture. No provider request, production write or installed acceptance. Chat send is separately mocked and labelled in sharedChat.', results }, null, 2))
  }
  console.log(JSON.stringify({ writerCasesPassed: results.length }))
}

async function sharedChatAssertions(browser) {
 const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
 const page = await context.newPage(); page.setDefaultTimeout(15000)
 const errors=[], blocked=[]; page.on('pageerror',error=>errors.push(error.message))
 await page.route('**/*',route=>{ const url=new URL(route.request().url()); if(url.hostname==='127.0.0.1'&&url.port==='5188')return route.continue(); blocked.push(url.origin); return route.abort() })
 await page.goto(`${base}?panel=writer&answer=fixture&surface=content&state=empty&theme=light`)
 const composer=page.getByRole('textbox',{name:/^Message/})
 const form=page.locator('.department-chat-main')
 await composer.fill('First offline question')
 await form.evaluate(node=>{ node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})) })
 await page.getByRole('dialog',{name:'Confirm AI data sharing',exact:true}).waitFor()
 await page.getByRole('button',{name:'Allow and ask Anka AI',exact:true}).click()
 await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.engagementMessages.length===2 && document.querySelector('.department-chat-prompt textarea')?.value==='')
 await composer.fill('Follow-up offline question')
 await form.evaluate(node=>{ node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})) })
 await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.engagementMessages.length===4 && document.querySelector('.department-chat-prompt textarea')?.value==='')
 assert.equal(await page.getByRole('dialog',{name:'Confirm AI data sharing',exact:true}).count(),0)
 const turns=await page.evaluate(()=>globalThis.__directChatPreview.fixture.engagementTurns)
 assert.equal(turns.length,2); assert.notEqual(turns[0].client_request_id,turns[1].client_request_id)
 assert.equal(turns[0].prompt,'First offline question'); assert.equal(turns[1].prompt,'Follow-up offline question')
 await composer.fill('Keep unsent after saved answers')
 await page.getByRole('link',{name:'Home',exact:true}).click()
 const draft=page.getByRole('dialog',{name:'Unsent chat draft',exact:true}); await draft.waitFor()
 await draft.getByRole('button',{name:'Stay',exact:true}).click()
 assert.equal(await composer.inputValue(),'Keep unsent after saved answers')
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
 const file=path.join(output,'b3-content-writer-browser-evidence.json'), evidence=JSON.parse(await fs.readFile(file,'utf8'))
 evidence.sharedChat={scope:'Actual compact workbench in one existing saved conversation, mock answer persistence only; fresh-chat atomic creation and live provider acceptance not exercised',firstAndFollowupSingleFlight:true,oneConsentForUnchangedScope:true,distinctDurableRequestIds:true,savedMessages:4,routeStayPreservesUnsentDraft:true,providerCalls:0,productionWrites:0,pageErrors:errors,blockedRemoteRequests:blocked}
 await fs.writeFile(file,JSON.stringify(evidence,null,2));await context.close();console.log('VERIFY actual shared Chat: two local turns, duplicate submissions suppressed, consent reused, route draft preserved')
}

async function videoBriefPrototypeAssertions(browser) {
 const results=[]
 for(const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],blocked=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'&&url.port==='5188')return route.continue();blocked.push(url.origin);return route.abort()})
  await page.goto(`${base}?panel=video-brief&surface=design&state=populated&theme=${theme}`)
  const pane=page.getByRole('region',{name:'Versioned video brief',exact:true}),preview=page.getByRole('button',{name:'Preview complete video brief',exact:true})
  await pane.waitFor();assert(await preview.isDisabled())
  const fields={'Purpose':'Explain the launch','Audience':'Returning clients','Channel / placement':'Organic social','Source assets / reuse plan':'None — text-to-video only','Script / storyboard':'Show the product, then three benefits','Brand constraints':'No unlicensed marks','Required text':'Launch date: 10 October'}
  for(const [name,value] of Object.entries(fields))await pane.getByRole('textbox',{name,exact:true}).fill(value)
  await preview.click();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.briefWrites),0)
  const review=page.getByRole('region',{name:'Confirm exact video brief',exact:true});await review.waitFor()
  assert((await review.innerText()).includes('Launch date: 10 October'))
  assert(await review.evaluate(node=>node.contains(document.activeElement)))
  const screenshot=`b3-video-brief-prototype-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,screenshot)})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  const confirm=page.getByRole('button',{name:'Confirm video brief version',exact:true})
  await confirm.evaluate(node=>{node.click();node.click()})
  await pane.getByText('Exact brief v1 confirmed.',{exact:false}).waitFor()
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.briefWrites),1)
  await pane.getByRole('textbox',{name:'Required text',exact:true}).fill('Launch date: 18 October')
  assert.equal(await pane.getByText('Exact brief v1 confirmed.',{exact:false}).count(),0)
  await preview.click();await page.evaluate(()=>{globalThis.__directChatPreview.fixture.briefLostResponse=true});await confirm.click()
  await pane.getByText('Original confirmation response lost',{exact:false}).waitFor();assert(await preview.isDisabled())
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.briefWrites),2)
  await page.getByRole('button',{name:'Check saved brief',exact:true}).click()
  await pane.getByText('Exact brief v2 confirmed.',{exact:false}).waitFor()
  const evidence=await page.evaluate(()=>{const f=globalThis.__directChatPreview.fixture;return {writes:f.briefWrites,versions:f.data.videoBriefVersions.map(v=>({id:v.id,parent:v.parent_version_id,text:v.content.video_brief.required_text})),reads:f.briefReads,generationCalls:f.videoGenerationCalls}})
  assert.equal(evidence.writes,2);assert.equal(evidence.versions[0].text,'Launch date: 10 October');assert.equal(evidence.versions[1].text,'Launch date: 18 October');assert.equal(evidence.versions[1].parent,evidence.versions[0].id);assert.equal(evidence.generationCalls,0);assert(evidence.reads.at(-1).operation_key)
  await pane.getByRole('textbox',{name:'Purpose',exact:true}).fill('Keep my unsaved refreshed brief')
  await page.reload();await pane.waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="Purpose"]')?.value==='Keep my unsaved refreshed brief')
  assert.equal(await pane.getByRole('textbox',{name:'Required text',exact:true}).inputValue(),'Launch date: 18 October');assert.equal(await pane.getByText('Exact brief v2 confirmed.',{exact:false}).count(),0)
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.data.videoBriefVersions.length),2);assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.videoGenerationCalls),0)
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({viewport:{width,height},theme,screenshot,currentDraftSurvivesRefresh:true,noNewVersionOnRefresh:true,allBriefFieldsExplicit:true,previewWrites:0,firstDoubleConfirmWrites:1,editInvalidatesConfirmation:true,twoIntentionalMockVersions:true,exactParentSourceRetained:true,lostResponseRecoveryReadOnly:true,generationCalls:0,pageErrors:errors,blockedRemoteRequests:blocked})
  await context.close();console.log('VERIFY video brief prototype',width,height,theme)
 }
 const file=path.join(output,'b3-content-writer-browser-evidence.json'),existing=JSON.parse(await fs.readFile(file,'utf8'));existing.videoBriefPrototype={...existing.videoBriefPrototype,scope:'Standalone real DesignVideoBriefEditor; saved canonical versions and recovery are fixture-only. No native database, installed contract, Generate integration or provider acceptance.',results};await fs.writeFile(file,JSON.stringify(existing,null,2))
}

async function designBridgeAssertions(browser) {
 const results=[]
 for (const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]) {
  const context=await browser.newContext({viewport:{width,height}}), page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],blocked=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'&&url.port==='5188')return route.continue();blocked.push(url.origin);return route.abort()})
  await page.goto(`${base}?surface=design&state=empty&theme=${theme}`)
  const message=page.getByRole('textbox',{name:'Message',exact:true}), videoButton=page.getByRole('button',{name:'Video tools',exact:true})
  await message.waitFor();assert(await videoButton.isDisabled());assert.equal(await page.getByRole('region',{name:'Private Design video tools',exact:true}).count(),0)
  await message.fill('Private Design exploration')
  await page.getByRole('button',{name:'Send',exact:true}).click()
  await page.getByRole('button',{name:'Allow and ask Anka AI',exact:true}).click()
  await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.data.counters.run===1)
  await videoButton.click()
  const workbench=page.getByRole('region',{name:'Private video workbench',exact:true})
  await workbench.getByRole('heading',{name:'Video · Higgsfield Seedance 2.5',exact:true}).waitFor()
  await workbench.getByText('No video jobs recorded for this private conversation.',{exact:true}).waitFor()
  assert(await workbench.getByRole('button',{name:'Generate one video',exact:true}).isDisabled())
  assert(await workbench.getByRole('button',{name:'Back to chat',exact:true}).evaluate(node => node === document.activeElement))
  const openingBounds=await workbench.getByRole('button',{name:'Back to chat',exact:true}).boundingBox();assert(openingBounds && openingBounds.y>=100 && openingBounds.y<300,`Video return control not visible near opening: ${JSON.stringify(openingBounds)}`)
  const openScreenshot=`b3-design-private-video-open-${theme}-${width}x${height}.png`
  await page.screenshot({path:path.join(output,openScreenshot)})
  await workbench.getByRole('textbox',{name:'Script / storyboard',exact:true}).fill('Unsent private video brief')
  await workbench.getByRole('button',{name:'Check exact quote',exact:true}).click()
  await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.videoQuotes.length===1)
  assert(await workbench.getByRole('button',{name:'Generate one video',exact:true}).isDisabled())
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.videoGenerationCalls),0)
  const screenshot=`b3-design-private-video-${theme}-${width}x${height}.png`
  await page.screenshot({path:path.join(output,screenshot)})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await workbench.getByRole('button',{name:'Back to chat',exact:true}).click()
  assert.equal(await workbench.isVisible(),false)
  assert(await videoButton.evaluate(node=>node===document.activeElement))
  await page.getByRole('combobox',{name:'Conversation context',exact:true}).selectOption('chat')
  await page.getByRole('button',{name:'Stay in current context',exact:true}).click()
  await videoButton.click()
  assert.equal(await workbench.getByRole('textbox',{name:'Script / storyboard',exact:true}).inputValue(),'Unsent private video brief')
  await workbench.getByRole('textbox',{name:'Script / storyboard',exact:true}).fill('')
  await workbench.getByRole('button',{name:'Back to chat',exact:true}).click()
  await message.fill('Text follow-up stays separate')
  await page.getByRole('button',{name:'Send',exact:true}).click()
  await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.data.counters.run===2)
  const evidence=await page.evaluate(()=>{const f=globalThis.__directChatPreview.fixture;return {counters:f.data.counters,conversationId:f.data.rows[0].id,videoReads:f.videoReads,videoQuotes:f.videoQuotes,generationCalls:f.videoGenerationCalls}})
  assert.equal(evidence.counters.created,1);assert.equal(evidence.counters.messages,2);assert.equal(evidence.generationCalls,0)
  assert.deepEqual([...new Set(evidence.videoReads)],[evidence.conversationId]);assert.equal(evidence.videoQuotes[0].private_conversation_id,evidence.conversationId)
  for(const key of ['project_id','engagement_id','messages','history','attachments'])assert(!(key in evidence.videoQuotes[0]))
  await videoButton.click()
  const brief=workbench.getByRole('region',{name:'Versioned video brief',exact:true}),business={'Purpose':'Explain the private launch','Audience':'Returning clients','Channel / placement':'Organic social','Source assets / reuse plan':'None — text-to-video only','Script / storyboard':'Product then three benefits','Brand constraints':'No unlicensed marks','Required text':'Launch date: 10 October'}
  for(const [name,value] of Object.entries(business))await brief.getByRole('textbox',{name,exact:true}).fill(value)
  await brief.getByRole('button',{name:'Preview complete video brief',exact:true}).click();assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.briefWrites),0)
  await brief.getByRole('button',{name:'Confirm video brief version',exact:true}).click();await brief.getByText('Exact brief v1 confirmed.',{exact:false}).waitFor()
  const providerPrompt=workbench.getByRole('textbox',{name:'Video prompt',exact:true});assert.equal(await providerPrompt.getAttribute('readonly'),'');assert((await providerPrompt.inputValue()).includes('Required text:\nLaunch date: 10 October'))
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.briefWrites),1);assert(await workbench.getByRole('button',{name:'Generate one video',exact:true}).isDisabled());assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.videoGenerationCalls),0)
  await providerPrompt.scrollIntoViewIfNeeded();const confirmedScreenshot=`b3-design-confirmed-brief-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,confirmedScreenshot)})
  await brief.getByRole('textbox',{name:'Required text',exact:true}).fill('Launch date: 18 October');assert.equal(await brief.getByText('Exact brief v1 confirmed.',{exact:false}).count(),0);assert.equal(await providerPrompt.inputValue(),'');assert(await workbench.getByRole('button',{name:'Generate one video',exact:true}).isDisabled());assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.data.videoBriefVersions.length),1)
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({viewport:{width,height},theme,screenshot,openScreenshot,confirmedScreenshot,actualCanonicalBriefEditorIntegrated:true,completePromptReadOnly:true,previewZeroWrites:true,oneImmutableMockConfirmation:true,editInvalidatesGenerate:true,noGenerationOnConfirmation:true,actualPrivateVideoUi:true,onePrivateChatTwoTextSends:true,explicitSeparateVideoTools:true,videoBriefPreservedOnCloseAndStay:true,exactPrivateAnchor:true,quoteOnlyGenerationDisabled:true,generationCalls:0,noHorizontalOverflow:true,pageErrors:errors,blockedRemoteRequests:blocked})
  await context.close();console.log('VERIFY Design private bridge',width,height,theme)
 }
 const file=path.join(output,'b3-content-writer-browser-evidence.json'),existing=JSON.parse(await fs.readFile(file,'utf8'))
 existing.designPrivateBridge={scope:'Actual Direct Chat, shared shell, PrivateDesignVideoTools and DesignVideoCapabilities against isolated localhost repositories. Quote makes no provider call; no verified Higgsfield connection and paid execution disabled. Actual generation, signed preview and project promotion are not accepted by this browser check.',results}
 await fs.writeFile(file,JSON.stringify(existing,null,2));console.log(JSON.stringify({designBridgeCasesPassed:results.length}))
}

async function widerDirectAssertions(browser){
 const results=[]
 for(const surface of ['organization','marketing']){
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],blocked=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'&&url.port==='5188')return route.continue();blocked.push(url.origin);return route.abort()})
  await page.goto(`${base}?surface=${surface}&state=empty&theme=light`)
  const input=page.getByRole('textbox',{name:'Message',exact:true});await input.fill('Scoped '+surface+' first message')
  await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByRole('button',{name:'Allow and ask Anka AI',exact:true}).click()
  await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.data.counters.run===1&&document.querySelector('.direct-chat-composer textarea').value==='')
  await input.fill('Scoped '+surface+' follow-up');await page.getByRole('button',{name:'Send',exact:true}).click()
  await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.data.counters.run===2)
  await page.reload();await input.waitFor();await page.getByRole('button',{name:new RegExp('Scoped '+surface+' first message')}).click();await page.waitForFunction(()=>document.querySelectorAll('.direct-chat-messages article').length>=2)
  const data=await page.evaluate(()=>globalThis.__directChatPreview.fixture.data)
  assert.equal(data.counters.created,1);assert.equal(data.counters.messages,2);assert.equal(data.counters.run,2)
  const row=data.rows.find(row=>row.context_kind===(surface==='organization'?'organization':'department_private'))
  assert.equal(row.project_id,null);assert.equal(row.department_id,surface==='organization'?null:'marketing')
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({surface,oneConversation:true,twoDistinctMessagesAndMockRuns:true,reloadDispatchesNothing:true,scope:row.context_kind,projectId:row.project_id,departmentId:row.department_id,providerCalls:0,productionWrites:0,pageErrors:errors,blockedRemoteRequests:blocked});await context.close()
 }
 const file=path.join(output,'b3-content-writer-browser-evidence.json'),evidence=JSON.parse(await fs.readFile(file,'utf8'));evidence.widerDirectChat={scope:'Actual shared DirectContextChat organization and Marketing-private paths with isolated backend; application bindings checked separately',results};await fs.writeFile(file,JSON.stringify(evidence,null,2));console.log(JSON.stringify({widerDirectCases:results}))
}

async function engagementFirstSendAssertions(browser) {
 const results=[]
 for (const [width,theme,uncertain] of [[1440,'light',false],[390,'dark',false],[1440,'dark',true]]) {
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage()
  page.setDefaultTimeout(15000);const errors=[],blocked=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'&&url.port==='5188')return route.continue();blocked.push(url.origin);return route.abort()})
  await page.goto(`${base}?panel=writer&answer=fixture&surface=content&state=empty&theme=${theme}`)
  const composer=page.getByRole('textbox',{name:/^Message/}),form=page.locator('.department-chat-main')
  await page.getByRole('button',{name:'New chat',exact:true}).click()
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.engagementConversations.length),1)
  await composer.fill('Fresh local first direction')
  const metrics=await form.evaluate(node=>({form:node.getBoundingClientRect().toJSON(),footer:node.querySelector('.department-chat-footer').getBoundingClientRect().toJSON(),send:node.querySelector('.department-chat-submit').getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth}))
  assert(!metrics.overflow);assert(metrics.footer.bottom<=metrics.form.bottom+1);assert(metrics.form.bottom<=900);assert(metrics.send.bottom<=metrics.form.bottom+1)
  await page.screenshot({path:path.join(output,`b3-engagement-new-${theme}-${width}x900.png`)})
  if(uncertain)await page.evaluate(()=>{const f=globalThis.__directChatPreview.fixture;f.engagementAnswerUncertain=true;f.engagementReadUnavailable=true})
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
  if(width===1440&&!uncertain)await page.evaluate(()=>{
   globalThis.__savedStorageSetItem=Storage.prototype.setItem
   Storage.prototype.setItem=function(key,value){if(key.startsWith('anka:engagement-first-send:'))throw new Error('Offline storage denied');return globalThis.__savedStorageSetItem.call(this,key,value)}
  })
  await page.getByRole('button',{name:'Allow and ask Anka AI',exact:true}).click()
  if(width===1440&&!uncertain){
   await page.getByText('First Send recovery storage is unavailable. No request was sent.',{exact:true}).waitFor()
   assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.engagementTurns.length),0)
   await page.evaluate(()=>{Storage.prototype.setItem=globalThis.__savedStorageSetItem;globalThis.__directChatPreview.fixture.firstSendNoReservation=true})
   await form.evaluate(node=>node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
   await page.getByText('Offline reservation denied before saving',{exact:true}).waitFor()
   assert.equal(await composer.inputValue(),'Fresh local first direction')
   assert.equal(await page.getByRole('button',{name:'Recover first Send',exact:true}).count(),0)
   assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.engagementConversations.length),1)
   await page.evaluate(()=>globalThis.__directChatPreview.fixture.firstSendNoReservation=false)
   await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
  }
  await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.engagementTurns.length===1)
  if(uncertain){
   await page.getByRole('button',{name:'Recover first Send',exact:true}).waitFor()
   assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isDisabled(),true)
   await page.reload()
   await page.getByRole('button',{name:'Recover first Send',exact:true}).click()
   await page.getByText('Recovered the saved first Send. No provider request was dispatched by recovery.',{exact:true}).waitFor()
  } else await page.waitForFunction(()=>document.querySelector('.department-chat-prompt textarea')?.value==='')
  const before=await page.evaluate(()=>globalThis.__directChatPreview.fixture.engagementTurns)
  assert.equal(before.length,1);assert.equal(before[0].start_new,true)
  assert.deepEqual(before[0].attachment_ids,[]);assert.deepEqual(before[0].selected_artifact_version_ids,[])
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.fixture.engagementConversations.length),2)
  assert.equal(await page.getByRole('button',{name:'Recover first Send',exact:true}).count(),0)
  assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('anka:engagement-first-send:')).length),0)
  await composer.fill('Fresh local follow-up')
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
  if(uncertain)await page.getByRole('button',{name:'Allow and ask Anka AI',exact:true}).click()
  await page.waitForFunction(()=>globalThis.__directChatPreview.fixture.engagementTurns.length===2&&document.querySelector('.department-chat-prompt textarea')?.value==='')
  const turns=await page.evaluate(()=>globalThis.__directChatPreview.fixture.engagementTurns)
  assert.equal(turns[1].start_new,undefined);assert.equal(turns[0].conversation_id,turns[1].conversation_id);assert.notEqual(turns[0].client_request_id,turns[1].client_request_id)
  assert.equal(await page.getByRole('dialog',{name:'Confirm AI data sharing',exact:true}).count(),0)
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  assert.equal(await page.getByText('OFFLINE SAVED ANSWER · Fresh local follow-up',{exact:true}).count(),1)
  const transcript=await page.locator('.department-chat-messages').boundingBox()
  assert(transcript.height >= (width>900?180:140),'Transcript must have primary readable space: '+width+' '+transcript.height)
  const optionalSave=page.getByRole('button',{name:'Save draft to this conversation',exact:true})
  assert.equal(await optionalSave.isVisible(),false)
  await page.getByText('Conversation details and sharing',{exact:true}).click()
  assert.equal(await optionalSave.isVisible(),true)
  await page.getByText('Optional: save unsent text for later without asking AI. Send already saves each submitted message.',{exact:true}).waitFor()
  await page.getByText('Conversation details and sharing',{exact:true}).click()
  let historyDrawer=null
  if(width<901){
   const history=page.getByRole('button',{name:'History',exact:true})
   await history.click();historyDrawer=await drawerAssertions(page,'Workshop history',history)
  }else{
   assert.equal(await page.locator('.workshop-conversation-rail').isVisible(),true)
   const search=page.getByRole('textbox',{name:'Search engagement conversations',exact:true})
   await search.fill('Fresh local first')
   await page.waitForFunction(()=>![...document.querySelectorAll('.workshop-conversation-rail button')].some(node=>node.textContent.includes('Page brief · separate project history')))
   await search.fill('')
   await page.getByRole('button',{name:/Page brief · separate project history/}).waitFor()
  }

  const savedMetrics=await form.evaluate(node=>({form:node.getBoundingClientRect().toJSON(),send:node.querySelector('.department-chat-submit').getBoundingClientRect().toJSON()}))
  assert(savedMetrics.send.bottom<=savedMetrics.form.bottom+1);assert(savedMetrics.send.height>25)
  await page.screenshot({path:path.join(output,`b3-engagement-saved-${theme}-${width}x900.png`)})
  results.push({viewport:{width,height:900},theme,lostResponseAndReloadRecovery:uncertain,storageDeniedSendsNothingAndConfirmedRollbackAllowsCorrection:width===1440&&!uncertain,newDraftCreatesZeroRecords:true,oneFirstSendAndOneFollowup:true,firstSendUsesNoInheritedFilesOrSources:true,sameConversationDistinctRequests:true,transcriptHeight:transcript.height,secondarySaveHiddenByDefault:true,desktopGroupedHistory:width>900,mobileHistoryDrawer:historyDrawer,providerCalls:0,productionWrites:0,pageErrors:errors,blockedRemoteRequests:blocked})
  await context.close()
 }
 const file=path.join(output,'b3-content-writer-browser-evidence.json'), evidence=JSON.parse(await fs.readFile(file,'utf8'))
 evidence.engagementFirstSend={scope:'Actual workbench with isolated mock backend; native SQL and Edge security checked separately; no live provider acceptance',results}
 await fs.writeFile(file,JSON.stringify(evidence,null,2));console.log(JSON.stringify({engagementFirstSendCases:results.length,results}))
}

;async function pipelineGroupAssertions(browser,declared=false) {
 const results=[]
 for (const [width,height,theme] of [[1440,900,'light'],[390,900,'dark']]) {
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[],blocked=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1' && url.port==='5188')return route.continue();blocked.push(url.origin);return route.abort()})
  await page.goto(`${base}?panel=pipelines&theme=${theme}${declared ? '&stage-contracts=1' : ''}`)
  const panel=page.getByRole('region',{name:'Project pipeline configuration',exact:true}),choice=page.getByRole('combobox',{name:'Pipeline selection',exact:true})
  await choice.waitFor();await page.waitForFunction(()=>!document.body.textContent.includes('Loading project configurations'))
  const identities=await page.evaluate(()=>({website:globalThis.__directChatPreview.pipeline.website,marketing:globalThis.__directChatPreview.pipeline.marketing}))
  await choice.selectOption(identities.website);assert.match(await panel.textContent(),/Active revision 2 · page_brief/);assert.doesNotMatch(await panel.textContent(),/Revision 3 · activated/)
  await choice.selectOption(identities.marketing);assert.match(await panel.textContent(),/Active revision 3 · campaign_plan/);assert.doesNotMatch(await panel.textContent(),/Revision 2 · activated/)
  await choice.selectOption('');assert.match(await panel.textContent(),/Active revision 9 · original_brief/)
  await panel.getByText('Create an independent pipeline',{exact:true}).click()
  await page.getByRole('textbox',{name:'Pipeline name',exact:true}).fill('Second website')
  await page.getByRole('combobox',{name:'Independent pipeline preset',exact:true}).selectOption({label:'Website delivery · execution v1'})
  await page.getByRole('button',{name:'Review pipeline creation',exact:true}).click()
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.calls.length),0)
  await page.getByRole('button',{name:'Confirm independent pipeline',exact:true}).scrollIntoViewIfNeeded()
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  const reviewScreenshot=`b2-pipeline-review-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,reviewScreenshot)})
  await page.getByRole('button',{name:'Confirm independent pipeline',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('Choose steps and review activation separately'))
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.calls.length),1)
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.runCalls.length),0)
  await panel.getByRole('combobox',{name:'Published execution definition',exact:true}).selectOption({label:'Website delivery · v1'})
  if(declared){
   await panel.getByRole('combobox',{name:'Page brief decision',exact:true}).selectOption('reuse');await panel.getByRole('combobox',{name:'Page copy decision',exact:true}).selectOption('run');await panel.getByRole('spinbutton',{name:'Page copy quantity',exact:true}).fill('3')
   await panel.getByRole('combobox',{name:'Additional proof decision',exact:true}).selectOption('omit');await panel.getByRole('textbox',{name:'Additional proof omission reason',exact:true}).fill('Existing approved article supplies the evidence')
   await panel.getByRole('button',{name:'Preview stages before creation',exact:true}).click();assert.equal(await panel.getByRole('button',{name:'Confirm draft revision',exact:true}).isEnabled(),false);assert.match(await panel.textContent(),/Missing or incompatible input/);assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.configCalls.length),0)
   await panel.getByRole('button',{name:'Find approved versions',exact:true}).click();const exactVersion=await page.evaluate(()=>globalThis.__directChatPreview.pipeline.artifact.artifact_version_id)
   await panel.getByRole('combobox',{name:'Page brief approved version',exact:true}).selectOption(exactVersion);await panel.getByRole('combobox',{name:'Page copy input Approved source article',exact:true}).selectOption(exactVersion)
  }else {await panel.getByRole('spinbutton',{name:'Page brief quantity',exact:true}).fill('1');await panel.getByRole('spinbutton',{name:'Page copy quantity',exact:true}).fill('3')}

  await panel.getByRole('button',{name:'Preview stages before creation',exact:true}).click()
  const stageReview=panel.getByRole('region',{name:'Review pipeline stages',exact:true});await stageReview.waitFor()
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.configCalls.length),0)
  assert.match(await stageReview.textContent(),/Dependencies: page_brief/);if(declared){assert.match(await stageReview.textContent(),/Approved launch source · exact v2/);assert.match(await stageReview.textContent(),/Reason: Existing approved article supplies the evidence/);assert.match(await stageReview.textContent(),/Output: Page copy/)}else {assert.match(await stageReview.textContent(),/Output: not specified/);assert.match(await stageReview.textContent(),/Required inputs: not specified/)}
  const stageScreenshot=`b2-pipeline-${declared ? 'stage-fulfilment' : 'stages'}-${theme}-${width}x${height}.png`;await stageReview.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,stageScreenshot)})
  await panel.getByRole('button',{name:'Confirm draft revision',exact:true}).click();await page.waitForFunction(()=>globalThis.__directChatPreview.pipeline.configCalls.length===1)
  const exactConfiguration=await page.evaluate(()=>globalThis.__directChatPreview.pipeline.configCalls[0]);assert.deepEqual(exactConfiguration.selectedSteps,[{key:'page_brief',quantity:1},{key:'page_copy',quantity:3}]);assert.equal(exactConfiguration.maxAiCostMicrousd,0);assert.notEqual(exactConfiguration.pipelineGroupId,identities.website)
  if(declared){const version=await page.evaluate(()=>globalThis.__directChatPreview.pipeline.artifact.artifact_version_id);assert.deepEqual(exactConfiguration.stageDecisions,[{key:'page_brief',action:'reuse',artifact_version_id:version},{key:'page_copy',action:'run',quantity:3,inputs:[{key:'article',artifact_version_id:version}]},{key:'extra_proof',action:'omit',reason:'Existing approved article supplies the evidence'}]);assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.artifact.version_number),2)}
  const runChoice=page.getByRole('combobox',{name:'Run pipeline',exact:true});await runChoice.selectOption(identities.marketing)
  const run=page.getByRole('button',{name:'Request manual run review',exact:true});await run.scrollIntoViewIfNeeded();assert.equal(await run.isEnabled(),true)
  const runScreenshot=`b2-pipeline-run-${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(output,runScreenshot)})
  await run.click();await page.waitForFunction(()=>globalThis.__directChatPreview.pipeline.runCalls.length===1)
  await page.getByText('Pipeline: Launch campaign',{exact:true}).waitFor()
  const call=await page.evaluate(()=>globalThis.__directChatPreview.pipeline.runCalls[0]);assert.equal(call.pipelineGroupId,identities.marketing)
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({viewport:{width,height},theme,independentWebsiteMarketingLegacy:true,reviewZeroWrites:true,creationOneCommandNoRun:true,stageReviewZeroWrites:true,stageConfirmationOneExactDraft:true,publishedMetadataGapsExplicit:!declared,declaredOutputsAndMissingInputs:declared,exactApprovedVersionReuse:declared,optionalOmissionReason:declared,noNewSourceVersion:declared,runOneExactGroupReviewRequest:true,noHorizontalOverflow:true,pageErrors:errors,blockedRemoteRequests:blocked,screenshots:[reviewScreenshot,stageScreenshot,runScreenshot]})
  await context.close()
 }
 const packet=path.join(output,'b2-service-native-evidence.json');const evidence=JSON.parse(await fs.readFile(packet,'utf8'));const target=declared ? (evidence.stageFulfilment ||= {}) : evidence.independentPipelineGroups;target.browser={source:'tools/check-direct-chat-browser.cjs '+(declared ? '--stage-fulfilment' : '--pipeline-groups'),scope:'Actual configuration/run panels in existing Layout; provider-free synthetic published sources; no publisher journey or production writes',results};await fs.writeFile(packet,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({pipelineGroupsPassed:results.length,evidence:packet}))
}

async function pipelineDefinitionAssertions(browser){
 const results=[]
 for(const [width,theme] of [[1440,'light'],[390,'dark']]){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme}),page=await context.newPage(),errors=[],blocked=[]
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1' && u.port==='5188')return route.continue();blocked.push(u.origin);return route.abort()})
  await page.goto(`${base}?panel=definitions&theme=${theme}`)
  const pipeline=await page.evaluate(()=>globalThis.__directChatPreview.pipeline.definitionCatalog.publications[0].id)
  await page.getByLabel('Definition published preset',{exact:true}).selectOption(pipeline);await page.getByLabel('Execution version name',{exact:true}).fill('Website stages')
  await page.getByLabel('Step 1 key',{exact:true}).fill('article');await page.getByLabel('Step 1 label',{exact:true}).fill('Launch article');await page.getByLabel('Step 1 service',{exact:true}).selectOption(pipeline)
  await page.getByLabel('Step 1 declare output and inputs',{exact:true}).check();await page.getByLabel('Step 1 expected output',{exact:true}).fill('Approved launch article');await page.getByLabel('Step 1 allow approved source',{exact:true}).check();await page.getByLabel('Step 1 exact output type',{exact:true}).fill('blog_article');await page.getByLabel('Step 1 optional stage',{exact:true}).check()
  await page.getByRole('button',{name:'Add required input',exact:true}).click();await page.getByLabel('Input key',{exact:true}).fill('audience');await page.getByLabel('Input label',{exact:true}).fill('Target audience')
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.definitionCalls.length),0)
  await page.getByLabel('Step 1 expected output',{exact:true}).scrollIntoViewIfNeeded()
  const screenshot=`b2-pipeline-definition-${theme}-${width}x900.png`;await page.screenshot({path:path.join(output,screenshot)})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.getByRole('button',{name:'Save draft version',exact:true}).click();await page.getByRole('status').filter({hasText:/Execution definition v1 saved/}).waitFor()
  const calls=await page.evaluate(()=>globalThis.__directChatPreview.pipeline.definitionCalls)
  assert.equal(calls.length,1);assert.deepEqual(calls[0].steps[0].stage_contract,{optional:true,output_label:'Approved launch article',reuse_allowed:true,artifact_type:'content',output_type:'blog_article',required_inputs:[{key:'audience',label:'Target audience',kind:'manual'}]})
  assert.equal(await page.evaluate(()=>globalThis.__directChatPreview.pipeline.definitionRecords.approvals.length+globalThis.__directChatPreview.pipeline.definitionRecords.publications.length),0);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({theme,viewport:{width,height:900},explicitTypedMetadata:true,unsavedZeroWrites:true,oneExactImmutableDraft:true,noImplicitApprovalOrPublication:true,noHorizontalOverflow:true,pageErrors:errors,blockedRemoteRequests:blocked,screenshot});await context.close()
 }
 const packet=path.join(output,'b2-service-native-evidence.json'),evidence=JSON.parse(await fs.readFile(packet,'utf8'));evidence.publishedStageContracts.browser={source:'tools/check-direct-chat-browser.cjs --stage-definitions',scope:'Actual definition author in existing Layout; synthetic local fixture; no distinct-human publication acceptance',results};await fs.writeFile(packet,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({stageDefinitionsPassed:results.length,evidence:packet}))
}


async function pipelineInputAssertions(browser){
 const results=[]
 for(const [width,theme] of [[1440,'light'],[390,'dark']]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],blocked=[]
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1' && u.port==='5188')return route.continue();blocked.push(u.origin);return route.abort()})
  await page.goto(`${base}?panel=stage-inputs&theme=${theme}`);await page.getByText('Exact reviewed stage inputs',{exact:true}).click()
  const inputs=page.getByLabel('Exact reviewed stage inputs',{exact:true});await inputs.getByText(/Startup owners/).waitFor();assert.match(await inputs.textContent(),/AI use permitted/);assert.match(await inputs.textContent(),/existing approval; no regeneration/);assert.match(await inputs.textContent(),/Existing approved source supplies evidence/)
  await page.getByText(/^Run card ·/).click();assert.match(await page.locator('body').textContent(),/No regeneration or provider reservation/);assert.match(await page.locator('body').textContent(),/reviewed stage inputs shown above/)
  assert.equal(await page.getByRole('button',{name:'Acknowledge exact inputs',exact:true}).isDisabled(),true)
  await inputs.scrollIntoViewIfNeeded();const screenshot=`b2-pipeline-inputs-${theme}-${width}x900.png`;await page.screenshot({path:path.join(output,screenshot)})
  const stats=await page.evaluate(()=>({calls:globalThis.__directChatPreview.pipeline.runCalls.length+globalThis.__directChatPreview.pipeline.configCalls.length+globalThis.__directChatPreview.pipeline.calls.length,overflow:document.documentElement.scrollWidth>innerWidth}));assert.equal(stats.calls,0);assert.equal(stats.overflow,false);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({theme,viewport:{width,height:900},exactManualAndCanonicalVersionScopeBeforeConsent:true,reuseExcludedFromRegeneration:true,omissionReasonPreserved:true,reviewZeroWrites:true,noHorizontalOverflow:true,pageErrors:errors,blockedRemoteRequests:blocked,screenshot});await context.close()
 }
 const packet=path.join(output,'b2-service-native-evidence.json'),evidence=JSON.parse(await fs.readFile(packet,'utf8'));evidence.stageFulfilment.aiInputs.browser={source:'tools/check-direct-chat-browser.cjs --stage-inputs',scope:'Actual run/consent display in shared Layout; synthetic source fixture; no human consent or providers',results};await fs.writeFile(packet,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({stageInputsPassed:results.length,evidence:packet}))
}

(async () => {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const results = []
  const cases = [
    ['project', 'empty', 'light', 1440, 900],
    ['project', 'output-open', 'light', 1440, 900],
    ['content', 'populated', 'dark', 1280, 720],
    ['content', 'empty', 'system', 390, 900],
    ['content', 'output-open', 'dark', 390, 900],
    ['project', 'uncertain', 'system', 390, 900],
    ['content', 'empty', 'system', 320, 900],
  ]
  try {
    if(process.argv.includes('--website-bulk')){await websiteBulkAssertions(browser);return}
    if(process.argv.includes('--project-navigation')){await projectNavigationAssertions(browser);return}
    if(process.argv.includes('--stored-reporting')){await storedReportingAssertions(browser);return}
    if(process.argv.includes('--campaign-deliverables')){await campaignDeliverableAssertions(browser);return}
    if(process.argv.includes('--marketing-opportunities')){await marketingOpportunityAssertions(browser);return}
    if(process.argv.includes('--campaign-plan')){await campaignPlanAssertions(browser);return}
    if(process.argv.includes('--campaign-planning')){await campaignPlanningAssertions(browser);return}
    if(process.argv.includes('--reporting-bindings')){await reportingBindingsAssertions(browser);return}
    if(process.argv.includes('--stage-inputs')){await pipelineInputAssertions(browser);return}
    if(process.argv.includes('--stage-definitions')){await pipelineDefinitionAssertions(browser);return}
    if(process.argv.includes('--stage-fulfilment')){await pipelineGroupAssertions(browser,true);return}
    if (process.argv.includes('--pipeline-groups')) {await pipelineGroupAssertions(browser);return}
    if (process.argv.includes('--video-brief')) {await videoBriefPrototypeAssertions(browser);return}
    if (process.argv.includes('--design-bridge')) {await designBridgeAssertions(browser);return}
    if (process.argv.includes('--wider-direct')) {await widerDirectAssertions(browser);return}
    if (process.argv.includes('--engagement-first-send')) { await engagementFirstSendAssertions(browser); return }
    if (process.argv.includes('--shared-chat')) { await sharedChatAssertions(browser); return }
    if(process.argv.includes('--website-site-findings')){await websiteSiteFindingsAssertions(browser);return}
    if(process.argv.includes('--website-manual-check')){await websiteManualCheckAssertions(browser);return}
    if(process.argv.includes('--website-seo')){await websiteSeoAssertions(browser);return}
    if(process.argv.includes('--website-editor')){await websiteEditorAssertions(browser);return}
    if(process.argv.includes('--website-pages')){await websitePageAssertions(browser);return}
    if (process.argv.includes('--writer') || process.argv.includes('--writer-recovery')) { await writerAssertions(browser); return }
    for (const [surface, state, theme, width, height] of cases) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'light' })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      page.setDefaultNavigationTimeout(15000)
      console.log('VERIFY', surface, state, theme, width, height)
      const errors = [], blocked = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname === '127.0.0.1' && url.port === '5188') return route.continue()
        blocked.push(url.origin); return route.abort()
      })
      await page.goto(`${base}?surface=${surface}&state=${state}&theme=${theme}`)
      await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ state: 'attached' })
      if (state === 'output-open' && width < 901) await page.getByRole('dialog', { name: 'Saved reply output' }).waitFor()
      await page.waitForFunction(() => globalThis.__directChatPreview && document.querySelector('.direct-chat').style.getPropertyValue('--direct-chat-height'))
      const metrics = await page.evaluate(() => ({
        header: document.querySelector('.shell-header').getBoundingClientRect().toJSON(),
        messages: document.querySelector('.direct-chat-messages').getBoundingClientRect().toJSON(),
        composer: document.querySelector('.direct-chat-composer').getBoundingClientRect().toJSON(),
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      }))
      assert(!metrics.horizontalOverflow)
      assert(metrics.composer.bottom <= height && metrics.composer.x >= 0 && metrics.composer.right <= width)
      assert(metrics.messages.height >= 150, 'Too little readable message space')
      if (width < 768) assert(metrics.header.height <= 110, 'Mobile shell header is too tall')
      assert.equal(await page.locator('.direct-chat button').filter({ hasText: /^New chat$/ }).count(), 1)
      if(surface==='content'&&state==='populated'){
        const title=await page.evaluate(()=>globalThis.__directChatPreview.fixture.data.rows[0].title)
        const composer=page.locator('.direct-chat textarea').first();await composer.fill('Keep this unsent scoped draft')
        await page.getByRole('button').filter({hasText:title}).first().click()
        const decision=page.getByRole('group',{name:'Confirm conversation context switch',exact:true});await decision.waitFor()
        assert.equal(await composer.inputValue(),'Keep this unsent scoped draft');await decision.getByRole('button',{name:'Stay in current context',exact:true}).click();assert.equal(await composer.inputValue(),'Keep this unsent scoped draft')
        await composer.fill('')
      }
      const screenshot = `b3-refinement-${surface}-${state}-${theme}-${width}x${height}.png`
      await page.screenshot({ path: path.join(output, screenshot) })
      const result = { surface, state, theme, viewport: { width, height }, ...metrics, screenshot, singleCreationControl: true }
      if (width < 901 && state === 'output-open') {
        result.outputDrawer = await drawerAssertions(page, 'Saved reply output', page.getByRole('button', { name: 'Open reply', exact: true }))
      }
      if (width < 901 && state !== 'uncertain') {
        const history = page.getByRole('button', { name: 'History', exact: true })
        await history.click()
        result.historyDrawer = await drawerAssertions(page, 'Chat history', history)
      }
      if (width > 900 && surface === 'content') {
        await page.getByRole('button', { name: 'Website Content', exact: true }).click()
        await page.getByRole('button', { name: /Page brief · separate project history/ }).waitFor()
        const search = page.getByRole('textbox', { name: 'Search engagement conversations', exact: true })
        await search.fill('no matching title')
        await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(node => node.textContent.includes('Page brief · separate project history')))
        await search.fill('Page brief')
        await page.getByRole('button', { name: /Page brief · separate project history/ }).waitFor()
        assert.equal(await page.getByRole('region', { name: 'Private history', exact: true }).count(), 1)
        result.groupedHistory = { privateSectionPreserved: true, projectGroupPreserved: true, engagementExpansion: true, scopedSearchExcludesThenRestores: true }
      }
      if (theme === 'system' && state === 'empty') {
        const background = () => page.locator('.anka-shell').evaluate(node => getComputedStyle(node).backgroundColor)
        const light = await background()
        await page.emulateMedia({ colorScheme: 'dark' })
        await page.waitForFunction(previous => getComputedStyle(document.querySelector('.anka-shell')).backgroundColor !== previous, light)
        const dark = await background()
        await page.emulateMedia({ colorScheme: 'light' })
        await page.waitForFunction(previous => getComputedStyle(document.querySelector('.anka-shell')).backgroundColor === previous, light)
        result.systemAppearance = { light, dark, followsPreferenceChanges: true, restoredLight: true }
      }
      assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
      result.pageErrors = errors; result.blockedRemoteRequests = blocked
      results.push(result)
      await context.close()
    }
    await fs.writeFile(path.join(output, 'b3-refinement-browser-evidence.json'), JSON.stringify({ source: 'tools/check-direct-chat-browser.cjs', scope: 'provider-free localhost fixture; no installed-schema or provider acceptance', results }, null, 2))
    console.log(JSON.stringify({ passed: results.length, assertions: ['bounds', 'message space', 'single creation', 'grouped search', 'System media changes', 'drawer Tab/ShiftTab/Escape/focus'], evidence: path.join(output, 'b3-refinement-browser-evidence.json') }))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
