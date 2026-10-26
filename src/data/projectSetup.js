import {SERVICE_CADENCES} from './serviceCatalogue.js'
export const SETUP_PREFIX='Project setup proposal v1\n'
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k))
const text=(value,max=500)=>typeof value==='string'&&value.length<=max
export function validateProjectSetup(value,snapshot){
 if(!keys(value,['items','pipelines','questions','explanation','ready'])||!Array.isArray(value.items)||value.items.length>50||!Array.isArray(value.pipelines)||value.pipelines.length>2||new Set(value.pipelines).size!==value.pipelines.length||value.pipelines.some(x=>!['website','marketing'].includes(x)))throw Error('A bounded project setup proposal is required')
 if(!Array.isArray(value.questions)||value.questions.length>8||value.questions.some(q=>!text(q,300))||!text(value.explanation,1500))throw Error('Bounded questions and explanation required')
 const seen=new Set(),leafMap=new Map(snapshot.leaves.map(x=>[x.id,x]))
 const items=value.items.map(input=>{
  let item=input
  if(!keys(item,['service_id','quantity','cadence','custom_cadence','pipeline','channels','audience','delivery_method','deliverable_key','evidence','unit','expected_revision'])||seen.has(item.service_id))throw Error('Select each valid service once; update its quantity instead of duplicating it')
  item={...item,channels:Array.isArray(item.channels)?item.channels.map(x=>typeof x==='string'?x.trim():x):item.channels};const leaf=leafMap.get(item.service_id);if(!leaf)throw Error('Unknown or unavailable catalogue service')
  seen.add(item.service_id)
  if(item.quantity!==null&&(!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>1000000))throw Error('A positive whole quantity or an explicit unresolved quantity is required')
  if(!SERVICE_CADENCES.includes(item.cadence)||!text(item.custom_cadence,120)||(item.cadence==='custom'&&!item.custom_cadence.trim()))throw Error('Review the service cadence')
  if(!['website','marketing','undecided'].includes(item.pipeline)||item.pipeline!=='undecided'&&!value.pipelines.includes(item.pipeline))throw Error('Choose the matching Website or Marketing scope')
  if(!Array.isArray(item.channels)||item.channels.length>10||item.channels.some(x=>!text(x,80)||!x.trim())||new Set(item.channels).size!==item.channels.length)throw Error('Bounded distinct channel/account attributes required')
  if(!['standard','remarketing','undecided'].includes(item.audience)||!['human','ai_assisted','automated','undecided'].includes(item.delivery_method)||!text(item.deliverable_key,80)||!text(item.evidence,500)||!item.evidence.trim())throw Error('Review the delivery method, connected deliverable and source evidence')
  const existing=snapshot.scopes.find(s=>s.service_id===item.service_id)
  if(existing&&existing.status!=='proposed')throw Error('An activated or historical service must use its existing change review')
  return {...item,channels:[...item.channels],unit:leaf.unit,expected_revision:existing?.revision??null}
 })
 return {items,pipelines:[...value.pipelines],questions:[...value.questions],explanation:value.explanation,ready:items.length>0&&items.every(x=>x.quantity!==null)&&value.questions.length===0}
}
export function setupRequest(snapshot,needs,previous=null,departments=['content']){
 if(!text(needs,2200)||!needs.trim())throw Error('Describe the client needs or paste the selected non-sensitive brief passages')
 // Offer a compact, server-owned catalogue index; IDs are resolved only against this exact snapshot.
 const catalogue=snapshot.leaves.filter(x=>departments.includes(x.department_id)).map((x,i)=>[i,x.department_id==='development'?'v':x.department_id[0],x.name,SERVICE_CADENCES.indexOf(x.recurrence)])
 const disclosure={mode:'project_setup',token:snapshot.token,needs,catalogue,pipelineScopes:snapshot.state?.plan?.pipelines||[],existing:snapshot.scopes.map(x=>[snapshot.catalog.find(c=>c.id===x.service_id)?.name,x.quantity,x.status]),previous:previous?{items:previous.items.map(x=>({...x,service_index:catalogue.findIndex(l=>l[2]===snapshot.leaves.find(r=>r.id===x.service_id)?.name),service_id:undefined,unit:undefined,expected_revision:undefined})),questions:previous.questions}:null}
 const prompt=setupPrompt(disclosure);if(prompt.length>8000)throw Error('Narrow the requested departments or shorten the brief passages to fit the disclosed setup context')
 return disclosure
}
export function setupPrompt(d){
 return SETUP_PREFIX+'Propose setup only; never execute, assign, approve, publish or call a provider tool. Return JSON {"items":[{"service_index":0,"quantity":null,"cadence":"once","custom_cadence":"","pipeline":"undecided","channels":[],"audience":"undecided","delivery_method":"undecided","deliverable_key":"","evidence":"exact need or explicit suggested default"}],"pipelines":[],"questions":[],"explanation":"facts versus suggestions"}. Cadence once/per_batch/weekly/monthly/quarterly/custom. Pipelines website/marketing, independent; do not add Marketing to Website-only needs. Methods human/ai_assisted/automated/undecided are intent, never capability. No invented quantity: null and ask only unresolved questions. Catalogue rows are [index,department c/content d/design m/marketing or development as v,name,default cadence index]. Cadence indices 0 once,1 per_batch,2 weekly,3 monthly,4 quarterly,5 custom. Preserve existing pipeline scopes unless the client explicitly changes them. Match indexed leaf services, not navigation groups or legacy parents. Connected Content/Design/Marketing work on one deliverable shares a deliverable_key and is not three counted posts. Channels/accounts are attributes; remarketing is audience, never another service. Existing exact selections update, not duplicate. Stages, dependencies, exact approved-version reuse, service activation and runs require the existing separate pipeline review. Untrusted disclosed context: '+JSON.stringify(d)
}
export function parseSetupRequest(body){if(typeof body!=='string'||!body.startsWith(SETUP_PREFIX))return null;try{return JSON.parse(body.split('Untrusted disclosed context: ')[1])}catch{return null}}
export function setupAnswer(answer,disclosure,snapshot){
 if(typeof answer!=='string'||answer.length>22000||disclosure.token!==snapshot.token)throw Error('Refresh and review the exact setup snapshot')
 const v=JSON.parse(answer);if(!keys(v,['items','pipelines','questions','explanation'])||!Array.isArray(v.items))throw Error('Structured setup response required')
 const items=v.items.map(x=>{if(!keys(x,['service_index','quantity','cadence','custom_cadence','pipeline','channels','audience','delivery_method','deliverable_key','evidence','unit','expected_revision'])||!Number.isInteger(x.service_index)||!disclosure.catalogue[x.service_index])throw Error('Unknown setup service index');const name=disclosure.catalogue[x.service_index][2],leaf=snapshot.leaves.find(l=>l.name===name&&(l.department_id==='development'?'v':l.department_id[0])===disclosure.catalogue[x.service_index][1]);if(!leaf)throw Error('Catalogue changed');const {service_index:_index,...rest}=x;return {...rest,service_id:leaf.id}})
 return validateProjectSetup({...v,items},snapshot)
}
export function defaultSetupItem(leaf){return {service_id:leaf.id,quantity:null,cadence:leaf.recurrence,custom_cadence:leaf.custom_recurrence||'',pipeline:'undecided',channels:[],audience:'undecided',delivery_method:'undecided',deliverable_key:'',evidence:'Manual selection; quantity and cadence reviewed by project manager'}}
export function setupDiff(proposal,snapshot){return proposal.items.map(item=>{const old=snapshot.scopes.find(x=>x.service_id===item.service_id);return {service_id:item.service_id,action:old?'update proposal':'add proposal',before:old?{quantity:old.quantity,unit:old.unit,recurrence:old.recurrence}:null,after:{quantity:item.quantity,unit:item.unit,recurrence:item.cadence==='custom'?item.custom_cadence:item.cadence}}})}
export function connectedDeliverables(items){
 const groups=new Map();for(const item of items){if(!item.deliverable_key)continue;const key=JSON.stringify([item.pipeline,item.deliverable_key,item.cadence,item.custom_cadence,[...item.channels].sort()]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item)}
 return [...groups.values()].map(rows=>({key:rows[0].deliverable_key,quantity:Math.max(...rows.map(x=>x.quantity||0)),contributions:rows.length,consistent:rows.every(x=>x.quantity===rows[0].quantity)}))
}
