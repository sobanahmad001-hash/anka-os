import {createServer} from 'vite'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const server=await createServer({root,server:{host:'0.0.0.0',port:5194,strictPort:true},plugins:[{name:'mapping-offline',enforce:'pre',load(id){const p=id.replaceAll('\\','/');if(p.endsWith('/src/lib/supabase.js'))return 'export const supabase={functions:{invoke:async(_name,{body})=>globalThis.mappingFixture(body)}}';if(p.endsWith('/src/context/AuthContext.jsx'))return "export const useAuth=()=>({user:{id:'11111111-1111-4111-8111-111111111111'}})"}}]})
await server.listen();console.log('Mapping fixture http://127.0.0.1:5194/tools/workshop-execution-preview.html')
