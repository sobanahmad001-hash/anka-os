import React from 'react'
import {createRoot} from 'react-dom/client'
import Panel from '../src/components/DepartmentChatModelAllowlist.jsx'
import '../src/index.css'
const org='11111111-1111-4111-8111-111111111111'
const row={id:'22222222-2222-4222-8222-222222222222',display_name:'OpenAI Sol',provider:'openai',status:'verified',verified_model_ids:['gpt-6.1-sol'],department_ids:['content','design','marketing'],model_configurations:['content','design','marketing'].map(department_id=>({department_id,model_id:'gpt-6.1-sol'}))}
const privateRow={...row,id:'33333333-3333-4333-8333-333333333333',display_name:'OpenAI Sol Organization Private',organization_level:true,department_ids:[],model_configurations:[],context_model_configurations:[{model_id:'gpt-6.1-sol'}]}
globalThis.approvalCalls=[]
globalThis.approvalFixture=async(name,_args)=>{globalThis.approvalCalls.push(name);if(name==='listModelAllowlist')return {organization_id:org,connections:[row,privateRow]};await new Promise(r=>setTimeout(r,100));return {success:true}}
createRoot(document.getElementById('root')).render(<main className="min-h-screen bg-[var(--anka-surface)] p-4"><div className="mx-auto max-w-4xl"><Panel organizationId={org} connections={[row,privateRow]} canManage /></div></main>)
