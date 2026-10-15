import React from 'react'
import {createRoot} from 'react-dom/client'
import {createMemoryRouter,RouterProvider} from 'react-router-dom'
import DepartmentChat from '../src/components/DepartmentChat.jsx'
import {engagement,chatRepository} from './design-workbench-fixture.js'
import '../src/index.css'
import {engagementFirstSendKey,saveEngagementFirstSend} from '../src/data/engagementChatFirstSend.js'
import {createDepartmentChatRepository} from '../src/data/departmentChatTransport.js'
const params=new URLSearchParams(location.search),department=params.get('department')||'content',long=params.has('long')
const conversation={id:'fixture-chat',owner_id:'preview-user',state:'active',access_role:'owner',title:'Local layout fixture'}
chatRepository.getConversation=async()=>({conversation,messages:Array.from({length:40},(_,i)=>({id:`message-${i}`,role:i%2?'assistant':'user',author_id:'preview-user',status:'completed',body:`Layout fixture message ${i}. `.repeat(12),created_at:'2026-10-15T00:00:00Z'})),sharing:{can_manage:false,recipients:[]}})
if(!long){chatRepository.listConversations=async()=>[];chatRepository.searchConversations=async()=>({items:[],next_cursor:null})}
if(params.has('recovery')){
 const id='10000000-0000-4000-8000-000000000001',requestId='10000000-0000-4000-8000-000000000002'
 const key=engagementFirstSendKey({userId:'preview-user',organizationId:'preview-org',projectId:engagement.project_id,engagementId:engagement.id,departmentId:department})
 saveEngagementFirstSend(key,{conversationId:id,requestId})
 globalThis.recoveryFixture={ready:false,calls:[],key}
 const adapter=createDepartmentChatRepository({functions:{invoke:async(_name,{body})=>{
  globalThis.recoveryFixture.calls.push(body.action)
  if(body.action!=='get_conversation')throw Error('Only read-only recovery is allowed')
  if(!globalThis.recoveryFixture.ready)return {data:{error:'Synthetic readback unavailable'},status:503}
  return {data:{data:{conversation:{...conversation,id,title:'Recovered fixture'},messages:[{id:'saved-user',role:'user',author_id:'preview-user',client_request_id:requestId,status:'completed',sequence:1,body:'Synthetic saved question'},{id:'saved-answer',role:'assistant',status:'completed',sequence:2,body:'Synthetic saved answer'}],sharing:{can_manage:false,recipients:[]}}},status:200}
 }}})
 chatRepository.getConversation=adapter.getConversation
}
function Preview(){return <main style={{maxWidth:1100,margin:'auto',padding:16}}><header style={{height:180}}>Provider-free layout fixture</header><DepartmentChat departmentId={department} engagement={engagement} presentation="workbench" hideConversationList initialConversation={long?conversation:null}/><footer style={{height:300}}><button id="bottom-control">Bottom controls</button></footer></main>}
createRoot(document.getElementById('root')).render(<RouterProvider router={createMemoryRouter([{path:'*',element:<Preview/>}])}/> )