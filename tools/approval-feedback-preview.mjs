import {createServer} from 'vite'
const server=await createServer({server:{host:'0.0.0.0',port:5192,strictPort:true},plugins:[{name:'approval-offline',enforce:'pre',load(id){if(id.endsWith('/src/data/integrationRepository.js'))return "export const integrations=new Proxy({}, {get:(_,name)=>async(...args)=>globalThis.approvalFixture(name,args)})"}}]})
await server.listen()
