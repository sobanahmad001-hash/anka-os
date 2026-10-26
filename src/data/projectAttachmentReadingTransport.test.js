import test from 'node:test'
import assert from 'node:assert/strict'
import {createDirectChatFixture,actor,organizationId,projectId} from '../../tools/direct-chat-fixture.js'
import {createSpreadsheetMappingTransport} from './projectSpreadsheetMappingTransport.js'
import {prepareAttachmentReading} from './projectAttachmentReading.js'
const sheet={name:'Pages',rows:[{row:1,cells:['page_key','title','path']},{row:2,cells:['home','Home','/home']}]},source={name:'source.csv',sha256:'a'.repeat(64)},disclosure=prepareAttachmentReading({sheet,source,columns:[0,1,2]})
function setup(){const fixture=createDirectChatFixture({surface:'project'}),values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},scope={organizationId,projectId,actorId:actor,conversationId:crypto.randomUUID()},checks=[];return {fixture,values,args:{scope,storage,chat:fixture.chat,runner:fixture.runner,startConversation:true,checkCurrent:async phase=>{checks.push(phase);return 'approved-current-model'},consent:async()=>true},checks}}
test('explicit first attachment read starts one exact private Project Chat and double click dispatches once',async()=>{
 const {fixture,args,checks,values}=setup(),transport=createSpreadsheetMappingTransport(args);await Promise.all([transport.request(disclosure),transport.request(disclosure)]);assert.equal(fixture.data.counters.created,1);assert.equal(fixture.data.counters.messages,1);assert.equal(fixture.data.counters.run,1);assert.equal(fixture.data.rows.at(-1).id,args.scope.conversationId);assert.ok(checks.some(x=>x?.requiresExisting));assert.equal(values.size,0)
})
test('new Chat identity substitution prevents provider dispatch and retains original IDs for recovery',async()=>{
 const {fixture,args,values}=setup();args.chat={...fixture.chat,startContextConversation:async()=>({conversation:{id:crypto.randomUUID(),owner_id:actor,context_kind:'project_team',project_id:projectId},message:{id:crypto.randomUUID()}})};await assert.rejects(createSpreadsheetMappingTransport(args).request(disclosure),/identity changed/);assert.equal(fixture.data.counters.run,0);assert.equal(values.size,1);assert.doesNotMatch([...values.values()][0],/source.csv|Home|page_key/)
})
test('lost first Chat response is recovered by original human UUID and never starts or dispatches again',async()=>{
 const {fixture,args,values}=setup();fixture.createUncertain=true;fixture.recoveryAvailable=true;await assert.rejects(createSpreadsheetMappingTransport(args).request(disclosure),/response lost/);assert.equal(fixture.data.counters.created,1);assert.equal(fixture.data.counters.run,0);await assert.rejects(createSpreadsheetMappingTransport(args).request(disclosure),/original mapping/);await createSpreadsheetMappingTransport(args).recover(disclosure);assert.equal(fixture.data.counters.created,1);assert.equal(fixture.data.counters.messages,1);assert.equal(fixture.data.counters.run,0);assert.equal(fixture.data.counters.recover,1);assert.equal(values.size,0)
})

test('a lost clarification restores its original answer only for the same reviewed source scope',async()=>{
 const {fixture,args,values}=setup();fixture.runFailure=true;fixture.recoveryAvailable=true
 const original=prepareAttachmentReading({sheet,source,columns:[0,1,2],clarification:'Use the source path column',previous:{type:'website_pages',disclosedMapping:{page_key:0,title:1},questions:['Which planned path?']}})
 await assert.rejects(createSpreadsheetMappingTransport(args).request(original),/uncertain/);assert.equal(fixture.data.counters.run,1)
 const changed=prepareAttachmentReading({sheet,source:{...source,sha256:'b'.repeat(64)},columns:[0,1,2]});await assert.rejects(createSpreadsheetMappingTransport(args).recover(changed),/exact original/);assert.equal(fixture.data.counters.recover,0)
 await createSpreadsheetMappingTransport(args).recover(disclosure);assert.equal(fixture.data.counters.run,1);assert.equal(fixture.data.counters.recover,1);assert.equal(values.size,0)
})
