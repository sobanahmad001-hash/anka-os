import {createServer} from 'vite'
import {fileURLToPath} from 'node:url'
export async function startStagingPreview(){
 const root=fileURLToPath(new URL('../',import.meta.url)),mocks={
 '/src/context/AuthContext.jsx':"import {actor} from '/tools/website-block-fixture.js';export const useAuth=()=>({user:{id:actor},profile:{full_name:'Preview member',role:'admin'},signOut:()=>{}})",
 '/src/context/OrganizationContext.jsx':'export const useOrganization=()=>globalThis.__blockPreview.organization',
 '/src/data/websiteBlocks.js':'export const websiteBlocks=new Proxy({},{get:(_,key)=>(...args)=>globalThis.__blockPreview.fixture.repository[key](...args)})',
 '/src/data/websiteStagingClient.js':'export const websiteStaging=new Proxy({},{get:(_,key)=>(...args)=>globalThis.__blockPreview.fixture.staging.repository[key](...args)})',
 '/src/components/DepartmentChat.jsx':'export default function ChatFixture(){return null}',
 '/src/data/developmentStudioRepository.js':'export const developmentStudio=new Proxy({},{get:()=>()=>{throw Error("No synthetic Development tracking writes")}})',
 '/src/hooks/useNotifications.js':'export const useNotifications=()=>({notifications:[],unread:0,markRead:()=>{},markAllRead:()=>{}})',
 '/src/components/AssistantFloat.jsx':'export default function FixtureAssistant(){return null}',
 '/src/lib/supabase.js':"export const supabase={from:table=>{if(table!=='user_preferences')throw Error('Unexpected fixture table '+table);const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null}),upsert:async()=>({})};return q}}"
 }
 const server=await createServer({root,cacheDir:root+'/node_modules/.vite-website-staging',server:{host:'127.0.0.1',port:5212,strictPort:true,watch:null},plugins:[{name:'synthetic-native-block',enforce:'pre',load(id){const path=id.replaceAll('\\','/').split('?')[0];for(const[suffix,source]of Object.entries(mocks))if(path.endsWith(suffix))return source}}]})
 await server.listen();return server
}
