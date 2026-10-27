import {readFileSync} from 'node:fs'
import {createServer} from 'vite'
import {fileURLToPath} from 'node:url'
export async function startFloatingBriefPreview(){
 const root=fileURLToPath(new URL('../',import.meta.url))
 const mocks={
  '/src/context/AuthContext.jsx':"import {actor} from '/tools/direct-chat-fixture.js';export const useAuth=()=>({user:{id:actor},profile:{full_name:'Preview member',role:'admin'},signOut:()=>{}})",
  '/src/context/OrganizationContext.jsx':'export const useOrganization=()=>globalThis.__directChatPreview.organization',
  '/src/data/departmentChatRepository.js':'export const departmentChat=new Proxy({},{get:(_,key)=>(...args)=>globalThis.__directChatPreview.fixture.chat[key](...args)})',
  '/src/data/contextChatRunnerRepository.js':'export const contextChatRunner=new Proxy({},{get:(_,key)=>(...args)=>globalThis.__directChatPreview.fixture.runner[key](...args)})',
  '/src/data/designWorkshopRepository.js':'export const designWorkshop={forOrganization:()=>globalThis.__directChatPreview.fixture.designWorkshop}',
  '/src/data/integrationRepository.js':"import {allowlist} from '/tools/direct-chat-fixture.js';export const integrations={listModelAllowlist:async()=>allowlist,listForOrganization:async organization_id=>({organization_id,connections:[]})}",
  '/src/hooks/useNotifications.js':'export const useNotifications=()=>({notifications:[],unread:0,markRead:()=>{},markAllRead:()=>{}})',
  '/src/components/AssistantFloat.jsx':'export default function FixtureAssistant(){return null}',
  '/src/lib/supabase.js':"export const supabase={functions:{invoke:async()=>{throw Error('No network in fixture')}},from:table=>{if(table!=='user_preferences')throw Error('Unexpected fixture table '+table);const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null}),upsert:async()=>({})};return q}}"
 }
 const server=await createServer({root,cacheDir:root+'/node_modules/.vite-floating-brief',server:{host:'127.0.0.1',port:5198,strictPort:true},plugins:[{name:'offline-floating-brief',enforce:'pre',load(id){const path=id.replaceAll('\\','/').split('?')[0];/* Vite dev rewrites imports in place; hoist the existing lazy call after React. Production source is untouched. */if(path.endsWith('/src/components/DirectContextChat.jsx')){const source=readFileSync(path,'utf8'),first=source.split('\n')[0];return source.slice(first.length+1).replace("from 'react'","from 'react'\n"+first)}for(const[suffix,source]of Object.entries(mocks))if(path.endsWith(suffix))return source}}]})
 await server.listen();return server
}
if(process.argv[1]===fileURLToPath(import.meta.url)){await startFloatingBriefPreview();console.log('Local synthetic preview: http://127.0.0.1:5198/tools/floating-brief-preview.html')}
