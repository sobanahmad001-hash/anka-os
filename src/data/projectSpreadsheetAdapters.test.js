import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareProjectKeywordImportDraft, prepareProjectCalendarImport } from '../../supabase/functions/_shared/projectSpreadsheetAdapters.ts'
const id = n => `b0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function context(type, values) {
  return { actorId:id(1),organizationId:id(2),projectId:id(3),conversation:{id:id(4),owner_id:id(1),organization_id:id(2),project_id:id(3),context_kind:'project_team',state:'active'},
    attachment:{id:id(5),conversation_id:id(4),organization_id:id(2),project_id:id(3),uploaded_by:id(1),source_kind:'project_spreadsheet',share_with_recipients:false,ai_use_allowed:false,status:'reference_only',sha256_hex:'a'.repeat(64),original_name:'synthetic.csv'},
    preview:{projectId:id(3),type,batchId:'b'.repeat(64),rows:[{rowId:'c'.repeat(64),source:{fileSha256:'a'.repeat(64),fileName:'synthetic.csv',sheet:'Visible',row:2},values,action:'create',errors:[]}]}}
}
function keyword() {
  const x=context('keyword_plan',{term:'Service',locale:'en-US',target_page_key:'page:home',search_volume:'',notes:'Reviewed'})
  x.preview.rows[0].identity=JSON.stringify(['service','en-us','page:home'])
  x.architecture={version_id:id(6),organization_id:id(2),project_id:id(3),pages:[{page_key:'page:home',slug:'home'}]}
  return x
}
function calendar() {
  const x=context('content_calendar',{record_kind:'project_task',record_id:id(7),title:'Post',original_date:'2026-09-30',timezone:'Asia/Karachi',historical_status:'published',due_date:'2026-10-15'})
  x.preview.rows[0].identity='project_task:'+id(7);x.preview.rows[0].action='update';x.preview.rows[0].expectedRevision=3
  x.engagement={id:id(8),organization_id:id(2),project_id:id(3)};x.planningTimezone='Asia/Karachi'
  x.targets=[{record_kind:'project_task',id:id(7),organization_id:id(2),project_id:id(3),department_id:'marketing',title:'Post',row_version:3,due_date:'2026-10-10',status:'in_progress',assigned_to:id(9)}]
  return x
}
test('keyword missing measurement stays null and exact target architecture is retained',()=>{
  const out=prepareProjectKeywordImportDraft(keyword())
  assert.equal(out.content.schema_version,2);assert.equal(out.content.keywords[0].search_volume,null)
  assert.equal(out.content.source_architecture_version_id,id(6));assert.equal(out.content.keywords[0].target_page_slug,'home')
  assert.equal(out.approvalCreated,false);assert.equal(out.providerRequestMade,false)
})
test('keyword adapter rejects invented evidence, cross-project targets and truncation',()=>{
  for(const mutate of [x=>{x.architecture.project_id=id(99)},x=>{x.preview.rows[0].values.target_page_key='foreign'},x=>{x.preview.rows[0].values.search_volume='100'},x=>{x.preview.rows[0].values.approved=true}]){
    const x=keyword();mutate(x);assert.throws(()=>prepareProjectKeywordImportDraft(x))
  }
})
test('keyword update preserves unmapped metrics, unrelated targets, and exact version',()=>{
  const x=keyword();const initial=prepareProjectKeywordImportDraft(x).content
  initial.keywords[0].search_volume=0;initial.keywords[0].evidence_source='Reviewed manual evidence'
  initial.keywords.push({...initial.keywords[0],term:'Other'})
  delete x.preview.rows[0].values.search_volume;x.preview.rows[0].action='update'
  x.artifact={id:id(10),organization_id:id(2),project_id:id(3),artifact_type:'keyword_strategy'}
  x.expectedParentVersionId=id(11);x.latestVersion={id:id(11),artifact_id:id(10),organization_id:id(2),content:initial}
  const out=prepareProjectKeywordImportDraft(x)
  assert.equal(out.content.keywords[0].search_volume,0);assert.deepEqual(out.content.keywords[1],initial.keywords[1])
  x.expectedParentVersionId=id(12);assert.throws(()=>prepareProjectKeywordImportDraft(x),/current/)
})
test('ambiguous existing keyword intent identities are never silently merged',()=>{
  const x=keyword();const content=prepareProjectKeywordImportDraft(x).content;content.keywords.push({...content.keywords[0],intent:'Different intent'})
  x.artifact={id:id(10),organization_id:id(2),project_id:id(3),artifact_type:'keyword_strategy'};x.expectedParentVersionId=id(11)
  x.latestVersion={id:id(11),artifact_id:id(10),organization_id:id(2),content}
  assert.throws(()=>prepareProjectKeywordImportDraft(x),/ambiguous/)
})
test('calendar schedules only explicit current dates while historical labels remain private',()=>{
  const x=calendar();const out=prepareProjectCalendarImport(x)
  assert.deepEqual(out.rows[0],{row_id:'c'.repeat(64),record_kind:'project_task',record_id:id(7),expected_row_version:3,start_date:null,due_date:'2026-10-15',action:'update'})
  assert.equal(JSON.stringify(out.rows).includes('published'),false);assert.equal(out.privateReceipt.rows[0].historical_evidence.historical_status,'published')
  assert.equal(x.targets[0].status,'in_progress');assert.equal(x.targets[0].assigned_to,id(9))
})
test('historical calendar date does not replace current deadline; no-change is skip',()=>{
  const x=calendar();delete x.preview.rows[0].values.due_date
  const out=prepareProjectCalendarImport(x);assert.equal(out.rows[0].action,'skip');assert.equal(out.rows[0].due_date,'2026-10-10')
})
test('calendar rejects foreign/stale/renamed targets, timezone drift and invented records',()=>{
  for(const mutate of [x=>{x.targets[0].project_id=id(99)},x=>{x.targets[0].row_version++},x=>{x.targets[0].title='New'},x=>{x.planningTimezone='UTC'},x=>{x.preview.rows[0].values.record_kind='campaign_plan_draft'},x=>{delete x.preview.rows[0].values.record_id},x=>{x.preview.rows[0].values.assignee_id=id(99)}]){
    const x=calendar();mutate(x);assert.throws(()=>prepareProjectCalendarImport(x))
  }
})
test('all adapters deny shared/unverified sources, duplicate rows and oversized selected batches',()=>{
  for(const mutate of [x=>{x.attachment.share_with_recipients=true},x=>{x.attachment.status='processing'},x=>{x.preview.rows.push(structuredClone(x.preview.rows[0]))},x=>{x.preview.rows=Array(26).fill(x.preview.rows[0])}]){
    const x=keyword();mutate(x);assert.throws(()=>prepareProjectKeywordImportDraft(x))
  }
})
function calendarCreate(){
 const x=calendar();x.targets=[];const row=x.preview.rows[0];delete row.values.record_id;row.values.record_kind='engagement_work_item';row.values.calendar_key='source:post-001';delete row.values.due_date
 row.identity='calendar:source:post-001';row.action='create';row.expectedRevision=null;return x
}
test('approved calendar create emits unassigned canonical intent with historical evidence isolated',()=>{
 const x=calendarCreate(),out=prepareProjectCalendarImport(x)
 assert.equal(out.rows[0].action,'create');assert.equal(out.rows[0].record_id,null);assert.equal(out.rows[0].due_date,null)
 assert.equal(out.rows[0].calendar_key,'source:post-001');assert.equal(out.privateReceipt.rows[0].historical_evidence.historical_status,'published')
 assert.equal(JSON.stringify(out.rows).includes('published'),false);assert.equal(Object.hasOwn(out.rows[0],'assignee_id'),false)
 x.preview.rows[0].values.start_date='2026-10-14';x.preview.rows[0].values.due_date='2026-10-15'
 assert.equal(prepareProjectCalendarImport(x).rows[0].due_date,'2026-10-15')
})
test('calendar create denies missing stable identity, authority fields, duplicate title and unreviewed target',()=>{
 for(const mutate of [x=>{delete x.preview.rows[0].values.calendar_key},x=>{x.preview.rows[0].values.record_kind='project_task'},x=>{x.preview.rows[0].values.status='done'},x=>{x.preview.rows[0].values.assignee_id=id(99)},x=>{x.preview.rows[0].expectedRevision=3},x=>{x.preview.rows[0].values.due_date='2026-02-30'},x=>{x.targets=[{department_id:'marketing',title:'Post',id:id(55)}]}]){
 const x=calendarCreate();mutate(x);assert.throws(()=>prepareProjectCalendarImport(x))
 }
 const x=calendarCreate(),row=structuredClone(x.preview.rows[0]);row.rowId='d'.repeat(64);row.values.calendar_key='source:post-002';row.identity='calendar:source:post-002';x.preview.rows.push(row)
 assert.throws(()=>prepareProjectCalendarImport(x),/duplicate/)
})
test('keyed calendar re-import reviews current exact canonical version without recreating or overwriting newer title',()=>{
 const x=calendarCreate();x.preview.rows[0].action='update';x.preview.rows[0].expectedRevision=4
 x.targets=[{id:id(55),import_identity:'calendar:source:post-001',record_kind:'engagement_work_item',organization_id:id(2),project_id:id(3),engagement_id:id(8),department_id:'marketing',title:'Post',row_version:4,due_date:null,start_date:null}]
 x.preview.rows[0].values.due_date='2026-10-20'
 const out=prepareProjectCalendarImport(x);assert.equal(out.rows[0].record_id,id(55));assert.equal(out.rows[0].action,'update');assert.equal(out.rows[0].expected_row_version,4)
 x.targets[0].title='Newer work';assert.throws(()=>prepareProjectCalendarImport(x),/changed/)
})
