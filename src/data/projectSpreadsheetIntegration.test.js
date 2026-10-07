import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareMappingDisclosure,validateAssistedMapping,PROJECT_IMPORT_RELEASE_READY } from './projectSpreadsheetMappingAssist.js'
import { proposeImportMapping } from './projectSpreadsheetPreview.js'
import { createSpreadsheetMappingTransport } from './projectSpreadsheetMappingTransport.js'
import { createProjectSpreadsheetImportRepository } from './projectSpreadsheetImportRepository.js'
const id=n=>`d0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const scope={organizationId:id(1),projectId:id(2),conversationId:id(3),actorId:id(4)}
const sheet={hidden:false,rows:[{cells:['SECRET','title','path']},{cells:['PRIVATE','Home','/home']} ]}
test('released importer mapping sends only deliberately selected bounded cells',()=>{
 assert.equal(PROJECT_IMPORT_RELEASE_READY,true)
 const d=prepareMappingDisclosure(sheet,[1,2],'website_pages')
 assert(!JSON.stringify(d).includes('SECRET'));assert(!JSON.stringify(d).includes('PRIVATE'))
 assert.deepEqual(validateAssistedMapping('{"mapping":{"title":0,"planned_path":1},"questions":["Confirm URL"]}',d),{mapping:{title:1,planned_path:2},questions:['Confirm URL']})
 for(const value of ['{"mapping":{"approved":0}}','{"mapping":{"title":2}}','{"mapping":{"title":0,"purpose":0}}','{"mapping":{"title":"0"}}'])assert.throws(()=>validateAssistedMapping(value,d))
 assert.throws(()=>prepareMappingDisclosure({...sheet,hidden:true},[1],'website_pages'))
 assert.throws(()=>prepareMappingDisclosure(sheet,[1],'website_pages','restricted'),/Restricted/)
})
test('underscore and spaced aliases share one deterministic mapping; collisions require clarification',()=>{
 assert.deepEqual(proposeImportMapping(['page_key','title','planned_path','page_type','purpose'],'website_pages').mapping,{page_key:0,title:1,planned_path:2,page_type:3,purpose:4})
 const result=proposeImportMapping(['page_key','page key','title','planned_path'],'website_pages')
 assert.equal(result.mapping.page_key,undefined);assert(result.ambiguities.includes('Choose one column for page_key'))
})
test('mapping consent cancellation saves/dispatched nothing',async()=>{
 const stored=new Map(),storage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)}
 const transport=createSpreadsheetMappingTransport({chat:new Proxy({},{get(){throw Error('Unexpected save')}}),runner:{},scope,storage,checkCurrent:async()=>id(5),consent:async()=>false})
 await assert.rejects(transport.request(prepareMappingDisclosure(sheet,[1],'website_pages')),/cancelled/);assert.equal(stored.size,0)
})
test('mapping uncertain dispatch stores IDs only; exact recovery never redispatches',async()=>{
 const stored=new Map(),storage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)}
 let human,runs=0,recoveries=0,answer=false
 const chat={appendContextHumanMessage:async input=>{human={id:id(7),...input,body:input.message};return human},getContextConversation:async()=>({messages:[human,...(answer?[{role:'assistant',status:'completed',in_reply_to_message_id:id(7),body:'{"mapping":{"title":0}}'}]:[])]})}
 const runner={run:async()=>{runs++;throw Error('Lost dispatch response')},recover:async()=>{recoveries++;answer=true}}
 const args={chat,runner,scope,storage,checkCurrent:async()=>id(5),consent:async()=>true},d=prepareMappingDisclosure(sheet,[1],'website_pages')
 const transport=createSpreadsheetMappingTransport(args)
 await assert.rejects(transport.request(d),/Lost/);assert.equal(runs,1);assert(!JSON.stringify([...stored.values()]).includes('Home'))
 await assert.rejects(transport.request(d),/original/)
 const resumed=createSpreadsheetMappingTransport(args)
 await assert.rejects(resumed.recover(prepareMappingDisclosure(sheet,[2],'website_pages')),/exact original/);assert.equal(recoveries,0)
 assert.equal(await resumed.recover(d),'{"mapping":{"title":0}}');assert.equal(runs,1);assert.equal(recoveries,1);assert.equal(stored.size,0)
})
test('source transport binds original staging identity and denies substituted upload paths',async()=>{
 const sourceId=id(8),file={name:'synthetic.csv',size:32},path=`${scope.organizationId}/${scope.conversationId}/staging/${sourceId}`
 const calls=[];let pathValue=path
 const client={functions:{invoke:async(_,request)=>{calls.push(request.body);return {data:{attachment_id:sourceId,project_id:scope.projectId,conversation_id:scope.conversationId,status:'awaiting_upload',claimed_mime:'text/csv',upload:{path:pathValue,token:'synthetic-test-token'}},error:null}}},storage:{from:bucket=>({uploadToSignedUrl:async(p,_token,_file,options)=>{calls.push({bucket,path:p,options});return {error:null}}})}}
 const repo=createProjectSpreadsheetImportRepository(client,scope),reserved=await repo.reserveSource(file,sourceId,'restricted')
 await repo.uploadSource(file,reserved);assert.equal(calls[1].bucket,'department-chat-attachments');assert.equal(calls[1].options.upsert,false)
 pathValue='foreign/path';await assert.rejects(repo.reserveSource(file,sourceId,'internal'),/identity/)
 await assert.rejects(repo.uploadSource(file,{...reserved,upload:{path:'foreign/path',token:'synthetic-test-token'}}),/scope/)
})
test('new calendar preview requires stable keys and surfaces duplicate identities before commit',async()=>{
 const {previewSpreadsheetImport}=await import('./projectSpreadsheetPreview.js')
 const input={projectId:'a0000000-0000-4000-8000-000000000003',sourceSha256:'a'.repeat(64),sourceName:'synthetic.csv',type:'content_calendar',existingComplete:true,
 sheet:{name:'Visible',rows:[{row:1,cells:['calendar_key','record_kind','title','original_date','timezone']},{row:2,cells:['same:one','engagement_work_item','Post','2026-09-30','UTC']},{row:3,cells:['same:one','engagement_work_item','Other','2026-09-30','UTC']}]},mapping:{calendar_key:0,record_kind:1,title:2,original_date:3,timezone:4}}
 const duplicate=await previewSpreadsheetImport(input);assert.ok(duplicate.rows.every(r=>r.action==='error'&&r.errors.some(e=>e.includes('Duplicate'))))
 input.sheet.rows=input.sheet.rows.slice(0,2);input.sheet.rows[1].cells[0]='';assert.equal((await previewSpreadsheetImport(input)).rows[0].action,'error')
 input.sheet.rows[1].cells[0]='valid:one';assert.equal((await previewSpreadsheetImport(input)).rows[0].action,'create')
})
