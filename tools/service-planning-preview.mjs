import {createServer} from 'vite'
import {fileURLToPath} from 'node:url'
export async function startServicePlanningPreview(){const root=fileURLToPath(new URL('../',import.meta.url)),mocks={
 '/src/context/AuthContext.jsx':"import {actor} from '/tools/service-planning-fixture.js';export const useAuth=()=>({user:{id:actor},profile:{full_name:'Preview member',role:'admin'},signOut:()=>{}})",
 '/src/context/OrganizationContext.jsx':'export const useOrganization=()=>globalThis.__servicePlanPreview.organization',
 '/src/data/projectDeliveryPlans.js':'export const projectDeliveryPlans={read:(...args)=>globalThis.__servicePlanPreview.fixture.plan.read(...args),apply:(...args)=>globalThis.__servicePlanPreview.fixture.plan.apply(...args)}',
 '/src/data/projectPipelineConfigurations.js':'export const projectPipelineConfigurations=new Proxy({},{get:(_,key)=>(...args)=>globalThis.__servicePlanPreview.fixture.configuration[key](...args)})',
 '/src/data/projectSetupRepository.js':'export const projectSetupRepository={}',
 '/src/hooks/useNotifications.js':'export const useNotifications=()=>({notifications:[],unread:0,markRead:()=>{},markAllRead:()=>{}})',
 '/src/components/AssistantFloat.jsx':'export default function FixtureAssistant(){return null}',
 '/src/components/ProjectWebsitePagesPanel.jsx':'export default function FixturePages(){return null}',
 '/src/components/ProjectCampaignPlanningPanel.jsx':'export default function FixtureMarketing(){return null}',
 '/src/components/ProjectReportingBindingsPanel.jsx':'export default function FixtureResources(){return null}',
 '/src/lib/supabase.js':"export const supabase={from:table=>{if(table!=='user_preferences')throw Error('Unexpected fixture table '+table);const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null}),upsert:async()=>({})};return q}}"
};const server=await createServer({root,cacheDir:root+'/node_modules/.vite-service-planning',server:{host:'127.0.0.1',port:5202,strictPort:true,watch:null},plugins:[{name:'synthetic-service-planning',enforce:'pre',load(id){const path=id.replaceAll('\\','/').split('?')[0];for(const[suffix,source]of Object.entries(mocks))if(path.endsWith(suffix))return source}}]});await server.listen();return server}
