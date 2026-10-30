import {createServer,build} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const plugin={name:'isolated-asset-work-preview',enforce:'pre',load(id){const path=id.replaceAll('\\','/').split('?')[0]
 const maps={projectWebsitePages:'website.repository',projectPipelineConfigurations:'website.sourceRepository',projectWebsiteSeoObservations:'website.seoRepository',projectWebsiteVersionChecks:'website.versionChecksRepository',projectWebsiteSiteFindings:'website.siteFindingsRepository',projectCampaignPlanning:'marketing.repository'}
 for(const [name,value] of Object.entries(maps))if(path.endsWith('/src/data/'+name+'.js'))return `export const ${name}=new Proxy({},{get:(_,key)=>globalThis.__assetPreview.${value}[key]})`
 if(path.endsWith('/src/context/AuthContext.jsx'))return 'export function useAuth(){return {user:{id:globalThis.__assetPreview.actor}}}'
 if(path.endsWith('/src/lib/supabase.js'))return 'export const supabase={functions:{invoke:async()=>{throw Error("No live calls in asset preview")}},from:()=>{throw Error("No live data in asset preview")},rpc:()=>{throw Error("No live SQL in asset preview")}}'
}}
const config={root,configFile:false,plugins:[plugin,react(),tailwindcss()],cacheDir:root+'/outputs/asset-vite-cache',server:{host:'127.0.0.1',port:5246,strictPort:true,watch:null}}
export async function startAssetPreview(){const server=await createServer(config);await server.listen();return server}
export async function buildAssetPreview(){return build({...config,build:{outDir:'outputs/asset-work-preview',emptyOutDir:false,rollupOptions:{input:root+'/tools/asset-work-preview.html',output:{inlineDynamicImports:true}}}})}
if(process.argv.includes('--build'))await buildAssetPreview()
