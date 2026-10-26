import test from 'node:test'
import assert from 'node:assert/strict'
import {detectAttachmentWork,suggestAttachmentColumns,prepareAttachmentReading,attachmentReadingPrompt,validateAttachmentReading,attachmentReadPresentation,attachmentChatTitle,attachmentConversationHint,rememberAttachmentConversation,clearAttachmentConversation} from './projectAttachmentReading.js'
import {readProjectAttachmentSheet} from './readProjectAttachmentSheet.js'
const source={name:'original.csv',sha256:'a'.repeat(64)},sheet={name:'Pages',hidden:false,rows:[{row:1,cells:['page key','title','path','email','password']},{row:2,cells:['home','Home','/home','private@example.invalid','secret']}]}
test('parser-assisted auto detection chooses only an established adapter and excludes sensitive columns by default',()=>{
 assert.equal(detectAttachmentWork(sheet).type,'website_pages');assert.deepEqual(suggestAttachmentColumns(sheet),[0,1,2]);assert.equal(detectAttachmentWork({...sheet,rows:[{row:1,cells:['Property','Price','Bedrooms']}]}).type,null)
})
test('confirmed reading scopes only bounded selected samples and preserves exact source identity',()=>{
 const d=prepareAttachmentReading({sheet,source,columns:suggestAttachmentColumns(sheet)}),prompt=attachmentReadingPrompt(d);assert.ok(prompt.length<8000);assert.doesNotMatch(prompt,/private@example|secret/);assert.equal(d.source.sha256,source.sha256);assert.throws(()=>prepareAttachmentReading({sheet,source,columns:[0],classification:'restricted'}),/Restricted/)
})
test('formula rows are not sent as AI samples and original sheet stays unchanged',()=>{
 const withFormula={...sheet,formulas:[{row:2}]},d=prepareAttachmentReading({sheet:withFormula,source,columns:[0,1,2]});assert.deepEqual(d.payload.samples,[]);assert.equal(withFormula.rows.length,2)
})
test('AI proposals reject unsupported types, duplicates and out-of-scope mapping; missing required fields become clarification',()=>{
 const d=prepareAttachmentReading({sheet,source,columns:[0,1,2]}),reply={type:'website_pages',explanation:'Visible page planning sample.',mapping:{page_key:0,title:1,planned_path:2},questions:[]};assert.equal(validateAttachmentReading(JSON.stringify(reply),d).ready,true)
 for(const bad of [{...reply,type:'properties'},{...reply,mapping:{title:4}},{...reply,mapping:{page_key:0,title:0}}])assert.throws(()=>validateAttachmentReading(JSON.stringify(bad),d))
 const partial=validateAttachmentReading(JSON.stringify({...reply,mapping:{title:1}}),d);assert.equal(partial.ready,false);assert.equal(partial.questions.length,2)
 const reference=validateAttachmentReading(JSON.stringify({...reply,type:'reference_only',mapping:{}}),d);assert.equal(reference.ready,false)
})
test('Chat reading presentation reconstructs exact disclosed scope and a validated explanation, including multiline data',()=>{
 const d=prepareAttachmentReading({sheet:{...sheet,rows:[sheet.rows[0],{row:2,cells:['home','Line one\nLine two','/home']}]},source,columns:[0,1,2]}),human={id:'human',role:'user',body:attachmentReadingPrompt(d)},assistant={role:'assistant',in_reply_to_message_id:'human',body:JSON.stringify({type:'website_pages',explanation:'A page plan sample.',mapping:{page_key:0,title:1,planned_path:2},questions:[]})};assert.equal(attachmentReadPresentation(human,[human]).kind,'source');assert.equal(attachmentReadPresentation(assistant,[human]).ready,true);assert.equal(attachmentReadPresentation({...assistant,body:'malformed'},[human]),null)
})
test('CSV source is parsed locally once with an exact hash; unsupported or aborted sources are visible errors',async()=>{
 const bytes=new TextEncoder().encode('page key,title,path\nhome,Home,/home'),file={name:'original.csv',size:bytes.length,arrayBuffer:async()=>bytes.buffer};const result=await readProjectAttachmentSheet(file);assert.equal(result.workbook.sheets[0].rows[1].cells[1],'Home');assert.match(result.source.sha256,/^[a-f0-9]{64}$/);await assert.rejects(readProjectAttachmentSheet({...file,name:'unsupported.xls'}),/unsupported/);const c=new AbortController();c.abort();await assert.rejects(readProjectAttachmentSheet(file,{signal:c.signal}),/cancelled/)
})

test('generated attachment title presentation is readable without changing saved content or ordinary chat titles',()=>{
 const d=prepareAttachmentReading({sheet,source,columns:[0,1,2]}),row={id:'chat',title:attachmentReadingPrompt(d).replaceAll('\n',' ').slice(0,160)},human={id:'human',conversation_id:'chat',role:'user',body:attachmentReadingPrompt(d)},original=row.title
 assert.equal(attachmentChatTitle(row,[human]),'Attachment · original.csv');assert.equal(row.title,original);assert.equal(attachmentChatTitle({id:'other',title:'My original title'},[human]),'My original title')
})

test('uncertain empty-composer attachment reading retains only its scoped Chat ID for one hour',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},id=crypto.randomUUID();rememberAttachmentConversation('scope',id,storage,1000);assert.equal(attachmentConversationHint('scope',storage,1001),id);assert.equal(attachmentConversationHint('different',storage,1001),null);assert.deepEqual(Object.keys(JSON.parse([...values.values()][0])),['conversation_id','expires_at']);assert.equal(attachmentConversationHint('scope',storage,3601000),null);rememberAttachmentConversation('scope',id,storage,1000);clearAttachmentConversation('scope',storage);assert.equal(values.size,0)
})

test('credential columns stay excluded even when a retained or crafted selection tries to include them',()=>{assert.throws(()=>prepareAttachmentReading({sheet,source,columns:[0,4]}),/sensitive columns/);assert.equal(prepareAttachmentReading({sheet,source,columns:[0,1,2]}).payload.headers.length,3)})
