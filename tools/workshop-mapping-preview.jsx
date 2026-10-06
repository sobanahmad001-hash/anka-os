import React from 'react'
import {createRoot} from 'react-dom/client'
import Panel from '../src/components/WorkshopModelMappingPanel.jsx'
import '../src/index.css'
const organization_id='11111111-1111-4111-8111-111111111111',project_id='22222222-2222-4222-8222-222222222222',engagement_id='33333333-3333-4333-8333-333333333333'
const scope={organization_id,project_id,engagement_id}
globalThis.mappingCalls=[]
globalThis.mappingFixture=async body=>{globalThis.mappingCalls.push(body);if(body.action==='list_workshop_mappings')return {data:{result:{...scope,schema_version:1,token:'a'.repeat(32),project_name:'Anka Sphere · local fixture',candidates:['content','design','marketing'].flatMap(department_id=>['gpt-6.1-sol','gpt-6-luna','gpt-6-astra'].map((model_id,i)=>({department_id,connection_id:`44444444-4444-4444-8444-44444444444${i}`,display_name:['OpenAI Sol','OpenAI Luna','OpenAI Astra'][i],linked:false,models:[{id:project_id,model_id}]})))}}};return {data:{result:{...scope,schema_version:1,request_id:body.request_id,selections:body.selections,added:body.selections,persisted:true}}}}
createRoot(document.getElementById('root')).render(<main className="min-h-screen bg-[var(--anka-surface)] p-4 text-[var(--anka-ink)]"><div className="mx-auto max-w-4xl"><h1 className="text-xl font-semibold">Anka Sphere · local fixture</h1><Panel organizationId={organization_id} projectId={project_id} engagementId={engagement_id} membership={{role:'operations_admin'}} /></div></main>)
