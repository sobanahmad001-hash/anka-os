import {startContentJourneyPreview} from './project-content-journey-preview.mjs'
export function startWebsiteExecutionPreview(){return startContentJourneyPreview({port:5218,plugins:[{name:'offline-website-execution',enforce:'pre',load(id){const path=id.replaceAll('\\','/').split('?')[0]
 if(path.endsWith('/src/data/websiteBlocks.js'))return 'export const websiteBlocks=new Proxy({},{get:(_,key)=>(...args)=>globalThis.__websitePilot.block[key](...args)})'
 if(path.endsWith('/src/data/websiteStagingClient.js'))return 'export const websiteStaging=new Proxy({},{get:(_,key)=>(...args)=>globalThis.__websitePilot.stage[key](...args)})'
 if(path.endsWith('/src/lib/supabase.js'))return 'export const supabase={auth:{getUser:async()=>({data:{user:{id:globalThis.__websitePilot.actor}}})},functions:{invoke:async()=>{throw Error("No external transport in synthetic pilot")}},from:table=>{if(table!=="user_preferences")throw Error("Unexpected table "+table);const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null}),upsert:async()=>({})};return q}}'
 }}]})}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/website-execution-preview.mjs')){await startWebsiteExecutionPreview();console.log('Website execution preview 5218')}
