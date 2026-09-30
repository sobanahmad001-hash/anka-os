import { build, createServer } from 'vite'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const check = process.argv.includes('--check')
const config = { root, server: { host: '127.0.0.1', port: 5188, strictPort: true }, plugins: [{
  name: 'offline-direct-chat-only', enforce: 'pre',
  load(id) {
    const path = id.replaceAll('\\', '/').split('?')[0]
    if (path.endsWith('/src/data/contentStudioRepository.js')) return 'export const contentStudio = {forOrganization: () => ({load: (...args) => globalThis.__directChatPreview.fixture.contentStudio.load(...args),saveArtifact: (...args) => globalThis.__directChatPreview.fixture.contentStudio.saveArtifact(...args),copyContentWriterVersion: (...args) => globalThis.__directChatPreview.fixture.contentStudio.copyContentWriterVersion(...args)})}'
    if (path.endsWith('/src/components/DepartmentChat.jsx')) return `import React from 'react'; export default function OfflineEngagementChat() {return React.createElement('section',{className:'workspace-card p-5'},React.createElement('h2',null,'Engagement chat · isolated writer preview'),React.createElement('p',null,'The canonical writer UI is real. This placeholder does not exercise legacy engagement messaging or provider execution. Private chat is not transferred.'))}`
    if (path.endsWith('/src/context/AuthContext.jsx')) return `import { actor } from '/tools/direct-chat-fixture.js'; export const useAuth = () => ({user:{id:actor},profile:{full_name:'Preview member',role:'admin'},signOut:()=>{}});`
    if (path.endsWith('/src/context/OrganizationContext.jsx')) return `export const useOrganization = () => globalThis.__directChatPreview.organization;`
    if (path.endsWith('/src/data/departmentChatRepository.js')) return `export const departmentChat = new Proxy({}, {get: (_, key) => (...args) => globalThis.__directChatPreview.fixture.chat[key](...args)});`
    if (path.endsWith('/src/data/contextChatRunnerRepository.js')) return `export const contextChatRunner = new Proxy({}, {get: (_, key) => (...args) => globalThis.__directChatPreview.fixture.runner[key](...args)});`
    if (path.endsWith('/src/data/integrationRepository.js')) return `import {allowlist} from '/tools/direct-chat-fixture.js'; export const integrations = {listModelAllowlist: async () => allowlist};`
    if (path.endsWith('/src/hooks/useNotifications.js')) return 'export const useNotifications = () => ({notifications:[],unread:0,markRead:()=>{},markAllRead:()=>{}})'
    if (path.endsWith('/src/components/AssistantFloat.jsx')) return 'export default function OfflineAssistantFloat() { return null }'
    if (path.endsWith('/src/lib/supabase.js')) return `export const supabase = {from: table => {if(table !== 'user_preferences') throw new Error('Unexpected live-data path in offline fixture: '+table);const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:null,error:null}),upsert:async()=>({error:null})};return query}};`
    // The legacy branch is not exercised by this fixture, including its lazy tools.
    if (path.endsWith('/src/components/PrivateDesignVideoTools.jsx')) return 'export default function Unused() { return null }'
  },
}] }
if (check) {
  await build({ ...config, build: { write: false, rollupOptions: { input: fileURLToPath(new URL('./direct-chat-preview.html', import.meta.url)) } } })
  console.log('B1 preview builds in memory with provider-free module mocks; no port binding.')
} else {
  const server = await createServer(config)
  await server.listen()
  console.log('Provider-free B1 preview: http://127.0.0.1:5188/tools/direct-chat-preview.html')
}
