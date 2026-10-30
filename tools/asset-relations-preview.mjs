import {createServer,build} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const plugin={name:'isolated-asset-relations-preview',enforce:'pre',load(id){const p=id.replaceAll('\\','/').split('?')[0]
 const maps={projectAssetRelations:'repository',projectPageKeywordTargets:'keywordRepository'}
 for(const [name,key] of Object.entries(maps))if(p.endsWith('/src/data/'+name+'.js'))return `export const ${name}=new Proxy({},{get:(_,key)=>globalThis.__assetRelationsPreview.${key}[key]})`
 if(p.endsWith('/src/lib/supabase.js'))return 'export const supabase={functions:{invoke:async()=>{throw Error("No live calls in rehearsal")}},from:()=>{throw Error("No live data in rehearsal")},rpc:()=>{throw Error("No live SQL in rehearsal")}}'
 if(p.endsWith('/src/components/ContextConversationPanel.jsx'))return 'export default function(){return <section aria-label="Original conversation reader unavailable in rehearsal"><p>Original conversation reader is unavailable in this synthetic rehearsal. Open the canonical authorized app to read real messages; private history is not simulated.</p></section>}'
}}
const config={root,configFile:false,plugins:[plugin,react(),tailwindcss()],cacheDir:root+'/outputs/asset-relations-vite-cache',server:{host:'127.0.0.1',port:5248,strictPort:true,watch:null}}
export async function startAssetRelationsPreview(){const s=await createServer(config);await s.listen();return s}
export async function buildAssetRelationsPreview(){return build({...config,build:{outDir:'outputs/asset-relations-preview',emptyOutDir:false,rollupOptions:{input:root+'/tools/asset-relations-preview.html',output:{inlineDynamicImports:true}}}})}
if(process.argv.includes('--build'))await buildAssetRelationsPreview()
