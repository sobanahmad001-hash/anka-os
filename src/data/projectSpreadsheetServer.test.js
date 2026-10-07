import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync,strToU8 } from 'fflate'
import { inspectProjectImportBytes, projectImportAction, preparePrivateProjectImport } from '../../supabase/functions/_shared/projectSpreadsheetServer.ts'
import { spreadsheetSourceIdentity } from './projectSpreadsheetPreview.js'
import { createProjectSpreadsheetImportRepository,createProjectImportRecoverySession } from './projectSpreadsheetImportRepository.js'
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const scope={organizationId:id(1),projectId:id(2),conversationId:id(3),actorId:id(4)}
function workbook(xml,extra={}){return zipSync(Object.fromEntries(Object.entries({
  'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Visible" r:id="r1"/><sheet name="Hidden" state="veryHidden" r:id="r2"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${xml}</worksheet>`,...extra,
}).map(([k,v])=>[k,strToU8(v)])))}
const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
test('server XLSX parser uses literal values, hidden exclusions and physical provenance',()=>{
  const p=inspectProjectImportBytes(workbook('<cols><col min="2" max="2" hidden="1"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>title</t></is></c><c r="B1" t="inlineStr"><is><t>PRIVATE</t></is></c></row><row r="2"><c r="A2"><f>WEBSERVICE("https://invalid.test")</f><v>12</v></c></row><row r="3" hidden="1"><c r="A3" t="inlineStr"><is><t>HIDDEN</t></is></c></row></sheetData>'),mime)
  assert.equal(p.sheets[0].rows[1].cells[0],'12');assert.equal(p.sheets[0].rows[1].row,2);assert.equal(p.sheets[0].formulas.length,1)
  assert.equal(p.sheets[1].rows.length,0);assert.equal(JSON.stringify(p).includes('PRIVATE'),false);assert.equal(JSON.stringify(p).includes('HIDDEN'),false)
})
test('server strict XML rejects malformed, DTD, duplicate identities and external relationships',()=>{
  for(const xml of ['<sheetData>','<!DOCTYPE x><sheetData/>','<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="A1"><v>2</v></c></row></sheetData>'])assert.throws(()=>inspectProjectImportBytes(workbook(xml),mime))
  assert.throws(()=>inspectProjectImportBytes(workbook('<sheetData/>',{'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="https://invalid.test" TargetMode="External"/></Relationships>'}),mime))
})
test('HTTP action gate cannot be enabled by request flags and touches no client',async()=>{
  let calls=0;const client=new Proxy({},{get(){calls++;throw Error('Unexpected client access')}})
  for(const action of ['reserve_source','finish_source','preview','save_proposal','confirm','recover'])await assert.rejects(projectImportAction(client,{}, {action,releaseReady:true,enabled:true}),e=>e.status===503)
  assert.equal(calls,0)
})
test('proposal transport pins scope and UUID-only recovery never carries source content',async()=>{
  const calls=[];const repository=createProjectSpreadsheetImportRepository({functions:{invoke:async(_,args)=>{calls.push(args.body);return {data:null,error:null}}}},scope)
  assert.equal(await repository.recover(id(8)),null)
  assert.deepEqual(calls[0],{action:'recover',organization_id:scope.organizationId,conversation_id:scope.conversationId,request_id:id(8)})
  await assert.rejects(repository.confirm(id(8),'a'.repeat(64),false))
  assert.equal(calls.length,1)
})
test('single-flight save retains original UUID after lost response and retry; reload is read-only',async()=>{
  const stored=new Map();const storage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)}
  let calls=0;const ids=[];let receipt=null
  const repo={save:async(input,request)=>{calls++;ids.push(request);if(calls===1)throw Error('Lost response');return {request_id:request}},recover:async request=>{ids.push(request);return receipt},confirm:async request=>({request_id:request})}
  const session=createProjectImportRecoverySession(repo,scope,storage)
  const first=session.save({private:'NOT_PERSISTED'},'a'.repeat(64));const duplicate=session.save({},'a'.repeat(64));assert.equal(first,duplicate)
  await assert.rejects(first,/Lost/);assert.equal(calls,1);assert.deepEqual(Object.keys(JSON.parse([...stored.values()][0])),['requestId']);assert.equal(JSON.stringify([...stored.values()]).includes('NOT_PERSISTED'),false)
  const resumed=createProjectImportRecoverySession(repo,scope,storage);assert.equal(await resumed.recover(),null);assert.equal(calls,1)
  await resumed.retrySave({private:'NOT_PERSISTED'},'a'.repeat(64));assert.equal(ids[0],ids[ids.length-1])
  receipt={status:'accepted',result:{rows:[]}};await resumed.recover();assert.equal(stored.size,0);assert.equal(calls,2)
})
test('changed or authority-bearing remote receipts are rejected',async()=>{
  const bad={project_id:id(99),conversation_id:scope.conversationId,actor_id:scope.actorId,request_id:id(8),proposal_id:id(9),provider_request_made:false}
  const repo=createProjectSpreadsheetImportRepository({functions:{invoke:async()=>({data:bad,error:null})}},scope)
  await assert.rejects(repo.recover(id(8)),/scope/)
})
test('server reconstructs mapped website preview from checksum-verified private bytes with zero writes',async()=>{
 const bytes=strToU8('page_key,title,planned_path,page_type,purpose\nsynthetic:one,Synthetic service,/synthetic-service,service,Synthetic QA\n')
 const hash=await spreadsheetSourceIdentity(bytes),attachmentId=id(5),engagementId=id(6)
 const owned={...scope,conversation:{id:scope.conversationId,owner_id:scope.actorId,organization_id:scope.organizationId,project_id:scope.projectId,context_kind:'project_team',state:'active'},project:{planning_timezone:'UTC'}}
 const attachment={id:attachmentId,conversation_id:scope.conversationId,organization_id:scope.organizationId,project_id:scope.projectId,uploaded_by:scope.actorId,source_kind:'project_spreadsheet',status:'reference_only',ai_use_allowed:false,share_with_recipients:false,
   sha256_hex:hash,original_name:'synthetic.csv',verified_mime:'text/csv',byte_size:bytes.length,final_path:`${scope.organizationId}/${scope.conversationId}/final/${attachmentId}`}
 const admin={from:table=>{
   const data=table==='engagements'?{id:engagementId,project_id:scope.projectId,organization_id:scope.organizationId}:table==='department_chat_attachments'?attachment:[]
   const q={select(){return q},eq(){return q},neq(){return q},limit(){return q},order(){return q},maybeSingle:async()=>({data,error:null}),then(resolve){return Promise.resolve({data,error:null}).then(resolve)}};return q
 },storage:{from:()=>({download:async()=>({data:new Blob([bytes]),error:null})})},rpc:()=>{throw Error('Preview must never write')}}
 const request={engagement_id:engagementId,type:'website_pages',attachment_id:attachmentId,sheet_index:0,selected_rows:[2],mapping:{page_key:0,title:1,planned_path:2,page_type:3,purpose:4},title:'Synthetic draft'}
 const result=await preparePrivateProjectImport(admin,owned,request)
 assert.equal(result.zero_write,true);assert.equal(result.provider_request_made,false);assert.equal(result.payload.content.pages[0].page_key,'synthetic:one')
 assert.equal(result.source_receipt.rows[0].source.row,2);assert.equal(result.project_id,scope.projectId)
 attachment.sha256_hex='f'.repeat(64)
 await assert.rejects(preparePrivateProjectImport(admin,owned,request),/checksum/)
 attachment.sha256_hex=hash
 await assert.rejects(preparePrivateProjectImport(admin,owned,{...request,selected_rows:[2,2]}),/distinct/)
})
test('calendar server reconstructs create and receipt-matched re-import from private bytes without writes',async()=>{
 const bytes=strToU8('calendar_key,record_kind,title,original_date,timezone,historical_status,due_date\nsynthetic:post,engagement_work_item,Synthetic calendar,2026-09-30,UTC,published,2026-10-20\n')
 const hash=await spreadsheetSourceIdentity(bytes),attachmentId=id(5),engagementId=id(6)
 const owned={...scope,conversation:{id:scope.conversationId,owner_id:scope.actorId,organization_id:scope.organizationId,project_id:scope.projectId,context_kind:'project_team',state:'active'},project:{planning_timezone:'UTC'}}
 const attachment={id:attachmentId,conversation_id:scope.conversationId,organization_id:scope.organizationId,project_id:scope.projectId,uploaded_by:scope.actorId,source_kind:'project_spreadsheet',status:'reference_only',ai_use_allowed:false,share_with_recipients:false,sha256_hex:hash,original_name:'synthetic.csv',verified_mime:'text/csv',byte_size:bytes.length,final_path:`${scope.organizationId}/${scope.conversationId}/final/${attachmentId}`}
 let work=[],receipts=[]
 const admin={from:table=>{const data=table==='engagements'?{id:engagementId,project_id:scope.projectId,organization_id:scope.organizationId}:table==='department_chat_attachments'?attachment:table==='work_items'?work:table==='department_chat_proposals'?receipts:[]
 const q={select(){return q},eq(){return q},neq(){return q},is(){return q},in(){return q},limit(){return q},maybeSingle:async()=>({data,error:null}),then(resolve){return Promise.resolve({data,error:null}).then(resolve)}};return q},storage:{from:()=>({download:async()=>({data:new Blob([bytes]),error:null})})},rpc:()=>{throw Error('Unexpected canonical write')}}
 const request={engagement_id:engagementId,type:'content_calendar',attachment_id:attachmentId,sheet_index:0,selected_rows:[2],mapping:{calendar_key:0,record_kind:1,title:2,original_date:3,timezone:4,historical_status:5,due_date:6}}
 const created=await preparePrivateProjectImport(admin,owned,request)
 assert.equal(created.payload.rows[0].action,'create');assert.equal(created.zero_write,true)
 work=[{id:id(20),project_id:scope.projectId,organization_id:scope.organizationId,engagement_id:engagementId,department_id:'marketing',title:'Synthetic calendar',row_version:3,due_date:'2026-10-18',start_date:null}]
 receipts=[{import_source_receipt:created.source_receipt,import_result:{rows:[{row_id:created.payload.rows[0].row_id,action:'create',outcome:'verified',result:{record_id:id(20)}}]}}]
 const updated=await preparePrivateProjectImport(admin,owned,request)
 assert.equal(updated.payload.rows[0].action,'update');assert.equal(updated.payload.rows[0].record_id,id(20));assert.equal(updated.payload.rows[0].expected_row_version,3)
 work[0].row_version=4;assert.equal((await preparePrivateProjectImport(admin,owned,request)).payload.rows[0].expected_row_version,4)
 work=[];await assert.rejects(preparePrivateProjectImport(admin,owned,request),/unavailable/)
})
test('named project choices require current department/service authority and reject foreign engagement',async()=>{
 const {loadProjectImportTargets}=await import('../../supabase/functions/_shared/projectSpreadsheetServer.ts')
 const owned={...scope,conversation:{id:scope.conversationId}},trace=[]
 let member={department_id:'content',role:'contributor'}
 const admin={from:table=>{const data=table==='organization_memberships'?member:table==='engagements'?[{id:id(6),name:'Synthetic named workstream',status:'active'}]:table==='artifacts'?[{id:id(7),title:'Synthetic architecture'}]:table==='artifact_versions'?[{id:id(8),artifact_id:id(7),version_number:2}]:[]
 const q={select(){return q},eq(k,v){trace.push([table,k,v]);return q},neq(){return q},in(){return q},order(){return q},limit(){return q},maybeSingle:async()=>({data,error:null}),then(resolve){return Promise.resolve({data,error:null}).then(resolve)}};return q},rpc(){throw Error('Names must not write')}}
 const result=await loadProjectImportTargets(admin,owned,'website_pages',id(6))
 assert.equal(result.artifacts[0].label,'Synthetic architecture');assert.equal(result.engagements[0].label,'Synthetic named workstream');assert.equal(result.read_only,true)
 assert(trace.some(([table,k,v])=>table==='engagements'&&k==='project_id'&&v===scope.projectId))
 assert(trace.some(([table,k,v])=>table==='engagements'&&k==='engagement_services.service_catalog.department_id'&&v==='content'))
 await assert.rejects(loadProjectImportTargets(admin,owned,'website_pages',id(99)),/authorized/)
 member={department_id:'design',role:'contributor'};await assert.rejects(loadProjectImportTargets(admin,owned,'website_pages'),/authority/)
 const calendar=await loadProjectImportTargets(admin,owned,'content_calendar');assert.equal(calendar.artifacts.length,0)
})
