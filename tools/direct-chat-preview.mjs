import { build, createServer } from 'vite'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const check = process.argv.includes('--check')
const config = { root, cacheDir: '/tmp/anka-direct-chat-preview-vite-cache', server: { host: '127.0.0.1', port: 5188, strictPort: true }, plugins: [{
  name: 'offline-direct-chat-only', enforce: 'pre',
  load(id) {
    const path = id.replaceAll('\\', '/').split('?')[0]
    if (path.endsWith('/src/data/projectEngagementWorkspace.js')) return 'export const projectEngagementWorkspace={get:async(projectId,organizationId)=>{const w=globalThis.__directChatPreview.projectWorkspace;if(!w||w.project.id!==projectId||w.project.organization_id!==organizationId)throw Error("Offline exact Project fixture unavailable");return structuredClone(w)}}'
    if (['RetainerPlanningPanel','ProjectPlanningPanel','ProjectDraftActivation','ProjectLifecyclePanel','ProjectServiceScopePanel','ProjectManagerAssignment','ProjectDiscussionPanel','ProjectReviewEvidencePanel'].some(name=>path.endsWith('/'+name+'.jsx'))) return 'export default function UnrelatedWorkflowFixture(){return null}'
    if (path.endsWith('/src/data/contentStudioRepository.js')) return 'export const contentStudio = {forOrganization: () => ({load: (...args) => globalThis.__directChatPreview.fixture.contentStudio.load(...args),saveArtifact: (...args) => globalThis.__directChatPreview.fixture.contentStudio.saveArtifact(...args),copyContentWriterVersion: (...args) => globalThis.__directChatPreview.fixture.contentStudio.copyContentWriterVersion(...args)})}'
    if (path.endsWith('/src/data/pipelineExecutionDefinitions.js')) return 'export const pipelineExecutionDefinitions = new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__directChatPreview.pipeline.definitionRepository[key](...args)})'
    if (path.endsWith('/src/data/projectCampaignPlanning.js')) return 'export const projectCampaignPlanning=new Proxy({}, {get:(_,key)=>globalThis.__directChatPreview.campaign.repository[key]})'
    if (path.endsWith('/src/data/projectReportingControls.js')) return 'export const projectReportingControls=new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__directChatPreview.reporting.controlsRepository[key](...args)})'
    if (path.endsWith('/src/data/projectStoredReporting.js')) return 'export const projectStoredReporting=new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__directChatPreview.reporting.reportingRepository[key](...args)})'
    if (path.endsWith('/src/data/projectReportingBindings.js')) return 'export const projectReportingBindings=new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__directChatPreview.reporting.repository[key](...args)})'
    if (path.endsWith('/src/data/projectWebsiteSiteFindings.js')) return 'export const projectWebsiteSiteFindings=new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__directChatPreview.website.siteFindingsRepository[key](...args)})'
    if (path.endsWith('/src/data/projectWebsiteVersionChecks.js')) return 'export const projectWebsiteVersionChecks=new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__directChatPreview.website.versionChecksRepository[key](...args)})'
    if (path.endsWith('/src/data/projectWebsiteSeoObservations.js')) return 'export const projectWebsiteSeoObservations=new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__directChatPreview.website.seoRepository[key](...args)})'
    if (path.endsWith('/src/data/projectWebsitePages.js')) return 'export const projectWebsitePages=new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__directChatPreview.website.repository[key](...args)})'
    if (path.endsWith('/src/data/projectPipelineConfigurations.js')) return 'export const projectPipelineConfigurations = new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__directChatPreview.pipeline.repository[key](...args)})'
    if (path.endsWith('/src/data/pipelineRunIntents.js')) return 'export const pipelineRunIntents = new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__directChatPreview.pipeline.runRepository[key](...args)})'
    if (path.endsWith('/src/context/AuthContext.jsx')) return `import { actor } from '/tools/direct-chat-fixture.js'; export const useAuth = () => ({user:{id:actor},profile:{full_name:'Preview member',role:'admin'},signOut:()=>{}});`
    if (path.endsWith('/src/context/OrganizationContext.jsx')) return `export const useOrganization = () => globalThis.__directChatPreview.organization;`
    if (path.endsWith('/src/data/departmentChatRepository.js')) return `export const departmentChat = new Proxy({}, {get: (_, key) => (...args) => globalThis.__directChatPreview.fixture.chat[key](...args)});`
    if (path.endsWith('/src/data/contextChatRunnerRepository.js')) return `export const contextChatRunner = new Proxy({}, {get: (_, key) => (...args) => globalThis.__directChatPreview.fixture.runner[key](...args)});`
    if (path.endsWith('/src/data/designWorkshopRepository.js')) return 'export const designWorkshop = {forOrganization: () => globalThis.__directChatPreview.fixture.designWorkshop}'
    if (path.endsWith('/src/data/integrationRepository.js')) return `import {allowlist} from '/tools/direct-chat-fixture.js'; export const integrations = {listModelAllowlist: async () => allowlist,listForOrganization: async organization_id => ({organization_id,connections:[]})};`
    if (path.endsWith('/src/hooks/useNotifications.js')) return 'export const useNotifications = () => ({notifications:[],unread:0,markRead:()=>{},markAllRead:()=>{}})'
    if (path.endsWith('/src/components/AssistantFloat.jsx')) return 'export default function OfflineAssistantFloat() { return null }'
    if (path.endsWith('/src/lib/supabase.js')) return `export const supabase = {from: table => {if(table !== 'user_preferences') throw new Error('Unexpected live-data path in offline fixture: '+table);const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:null,error:null}),upsert:async()=>({error:null})};return query}};`
    // Actual private video UI uses the isolated repository above; generation is disabled.
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
