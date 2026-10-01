// Isolated, provider-free fixture. This module is never imported by production.
import { videoBriefCreativeContent } from '../supabase/functions/_shared/designVideoBrief.js'
import { contextChatTitleFromMessage } from '../src/data/contextChatTitle.js'
export const actor = 'a0000000-0000-4000-8000-000000000001'
export const organizationId = 'a0000000-0000-4000-8000-000000000002'
export const projectId = 'a0000000-0000-4000-8000-000000000003'
export const modelId = 'a0000000-0000-4000-8000-000000000004'
export const threadId = 'a0000000-0000-4000-8000-000000000005'
export const requestId = 'a0000000-0000-4000-8000-000000000006'
export const humanId = 'a0000000-0000-4000-8000-000000000007'
export const dispatchId = 'a0000000-0000-4000-8000-000000000008'
export const assistantId = 'a0000000-0000-4000-8000-000000000009'
export const ready = { paid_execution_enabled: true, spend_tracking_configured: true, model_status: 'configured', spend_guard_mode: 'local_monthly_cap' }
export const allowlist = { connections: [{ id: 'preview-connection', provider: 'openai', display_name: 'Approved text · fixture', organization_level: true, status: 'verified', context_model_configurations: [{ id: modelId, model_id: 'Approved text model · fixture' }] }] }
const failure = (message, status) => Object.assign(new Error(message), { status })

export function createDirectChatFixture({ surface = 'content', state = 'empty', stored, persist = () => {} } = {}) {
  const scope = surface === 'organization' ? { context_kind: 'organization', project_id: null, department_id: null } : ['marketing', 'design'].includes(surface) ? { context_kind: 'department_private', department_id: surface, project_id: null } : surface === 'project' ? { context_kind: 'project_team', project_id: projectId, department_id: null } : { context_kind: 'department_private', department_id: 'content', project_id: null }
  const seeded = state !== 'empty'
  const conversation = { id: threadId, ...scope, organization_id: organizationId, engagement_id: null, owner_id: actor, title: 'A clear introduction', state: 'active' }
  const human = { id: humanId, conversation_id: threadId, client_request_id: requestId, author_id: actor, role: 'user', body: 'Write a clear introduction for our project.', status: 'completed', sequence: 1 }
  const assistant = { id: assistantId, conversation_id: threadId, in_reply_to_message_id: humanId, role: 'assistant', status: 'completed', sequence: 2,
    body: 'OFFLINE FIXTURE · No provider call\n\nA clear introduction starts with the people we serve and the problem we help them solve. This saved reply is illustrative preview content.' }
  const data = stored || { rows: seeded ? [conversation] : [], messages: seeded ? [human, ...(['populated', 'output-open'].includes(state) ? [assistant] : [])] : [], counters: { created: 0, messages: 0, run: 0, recover: 0 } }
  const fixture = { data, scope, readiness: ready, runFailure: false, createUncertain: false, recoveryAvailable: !['failed', 'uncertain'].includes(state), beforeStart: null, beforeRun: null }
  fixture.videoReads = []; fixture.videoQuotes = []; fixture.videoGenerationCalls = 0
  fixture.briefWrites = 0; fixture.briefReads = []; fixture.briefLostResponse = false
  data.videoBriefVersions ||= []; data.videoBriefRoot ||= null
  fixture.designWorkshop = {
    getVideoBrief: async input => {
      if (!data.rows.some(row => row.id === input.private_conversation_id && row.department_id === 'design' && row.owner_id === actor && row.organization_id === organizationId) || input.direction_version_id || scope.department_id !== 'design') throw failure('Foreign video brief fixture',403)
      fixture.briefReads.push(structuredClone(input))
      const scopedVersions = data.videoBriefVersions.filter(row => row.content.video_context.private_conversation_id === input.private_conversation_id)
      const version = input.operation_key ? scopedVersions.find(row=>row.operation_key===input.operation_key) : scopedVersions.at(-1)
      return version ? {brief:structuredClone(data.videoBriefRoot),version:structuredClone(version)} : {}
    },
    confirmVideoBrief: async input => {
      if (!data.rows.some(row => row.id === input.private_conversation_id && row.department_id === 'design' && row.owner_id === actor && row.organization_id === organizationId) || input.direction_version_id || scope.department_id !== 'design') throw failure('Foreign video brief confirmation',403)
      const existing = data.videoBriefVersions.find(row=>row.operation_key===input.operation_key)
      if(existing) { if(JSON.stringify(existing.fixture_input)!==JSON.stringify(input))throw failure('Changed fixture brief operation',409);return {brief:structuredClone(data.videoBriefRoot),version:structuredClone(existing)} }
      if((input.creative_brief_id||null)!==(data.videoBriefRoot?.id||null) || input.expected_revision!==(data.videoBriefRoot?.revision||0))throw failure('Stale exact fixture brief revision',409)
      const id=crypto.randomUUID(),parent=data.videoBriefVersions.at(-1)
      data.videoBriefRoot={id:data.videoBriefRoot?.id||crypto.randomUUID(),organization_id:organizationId,created_by:actor,visibility:'private',revision:(data.videoBriefRoot?.revision||0)+2,frozen_version_id:id}
      const version={id,creative_brief_id:data.videoBriefRoot.id,organization_id:organizationId,created_by:actor,version_number:data.videoBriefVersions.length+1,parent_version_id:parent?.id||null,operation_key:input.operation_key,fixture_input:structuredClone(input),validation_snapshot:{valid:true,video_confirmation:{action:'confirm_video_brief',actor_id:actor,expected_revision:input.expected_revision,requested_root_id:input.creative_brief_id}},content:videoBriefCreativeContent(input.video_brief,{private_conversation_id:input.private_conversation_id})}
      data.videoBriefVersions.push(version);fixture.briefWrites++;save()
      if(fixture.briefLostResponse)throw failure('Original confirmation response lost · fixture',503)
      return {brief:structuredClone(data.videoBriefRoot),version:structuredClone(version)}
    },
    listPrivateVideoJobs: async id => { if (!data.rows.some(row => row.id === id && row.department_id === 'design' && row.owner_id === actor)) throw failure('Foreign private video fixture',403); fixture.videoReads.push(id); return [] },
    getPrivateVideoQuote: async input => { fixture.videoQuotes.push(structuredClone(input)); return { paid_execution_enabled: false, spend_tracking_configured: false, spend_guard_mode: null, quote: null } },
    generatePrivateVideo: async () => { fixture.videoGenerationCalls++; throw failure('Generation disabled in offline fixture',403) },
  }
  fixture.engagements = [{ id: 'a0000000-0000-4000-8000-000000000020', organization_id: organizationId, project_id: projectId, name: 'Website Content' }]
  fixture.workstreams = [{ project_id: projectId, projects: { name: 'Launch project' } }]
  const save = () => persist(data)
  function append(input) {
    const existing = data.messages.find(row => row.conversation_id === input.conversation_id && row.client_request_id === input.client_request_id)
    if (existing) { if (existing.body !== input.message) throw failure('Request body mismatch', 409); return existing }
    const message = { id: crypto.randomUUID(), conversation_id: input.conversation_id, client_request_id: input.client_request_id, author_id: actor,
      role: 'user', body: input.message, status: 'completed', sequence: data.messages.filter(row => row.conversation_id === input.conversation_id).length + 1 }
    data.messages.push(message); data.counters.messages++; save(); return message
  }
  function reply(messageId) {
    const source = data.messages.find(row => row.id === messageId)
    let message = data.messages.find(row => row.in_reply_to_message_id === messageId)
    if (!message) {
      message = { ...assistant, id: crypto.randomUUID(), conversation_id: source.conversation_id, in_reply_to_message_id: messageId,
        sequence: data.messages.filter(row => row.conversation_id === source.conversation_id).length + 1 }
      data.messages.push(message); save()
    }
    return { status: 'completed', message }
  }
  // Canonical writer example reuses this fixture's existing synthetic scope.
  fixture.writerWrites = 0
  fixture.writerUncertainAfterSave = false
  fixture.contentWorkspace = { engagement: { ...fixture.engagements[0], brand_id: modelId }, stages: [], approvals: [], copyRoots: [], organizationSettings: { default_language: 'English' },
    contentServices: [{ id: modelId, organization_id: organizationId, engagement_id: fixture.engagements[0].id, status: 'active', service_catalog: { department_id: 'content', is_active: true } }],
    artifacts: [{ id: requestId, organization_id: organizationId, engagement_id: fixture.engagements[0].id, artifact_type: 'content', title: 'Existing article' }],
    versions: [{ id: humanId, organization_id: organizationId, artifact_id: requestId, version_number: 1, data_classification: 'internal', content: { schema_version: 2, output_type: 'blog_article', working_title: 'Existing article', destination: 'Launch article', objective: 'Explain', audience: 'Team', language: 'English', body: 'Keep alpha and omega.', exclusions: [] } }] }
  fixture.contentStudio = {
    load: async () => fixture.contentWorkspace,
    saveArtifact: async input => {
      const source = fixture.contentWorkspace.versions.at(-1)
      if (input.engagement_id !== fixture.engagements[0].id || input.artifact_id !== requestId || input.expected_parent_version_id !== source.id) throw failure('Exact canonical source changed · fixture', 409)
      const version = { ...source, id: crypto.randomUUID(), parent_version_id: source.id, version_number: source.version_number + 1, content: structuredClone(input.content) }
      fixture.contentWorkspace = { ...fixture.contentWorkspace, versions: [...fixture.contentWorkspace.versions, version] }
      fixture.writerWrites++; if (fixture.writerUncertainAfterSave) throw failure('Saved response unavailable · offline fixture', 503); return { version_id: version.id }
    },
    copyContentWriterVersion: async () => { throw failure('Copy is not exercised by this isolated writer fixture.', 409) },
  }
  const engagementConversation = { id: 'a0000000-0000-4000-8000-000000000021', organization_id: organizationId, department_id: 'content', project_id: projectId, engagement_id: fixture.engagements[0].id, owner_id: actor, title: 'Page brief · separate project history', state: 'active', access_role: 'owner' }
  fixture.engagementConversations = data.engagementConversations || [engagementConversation]
  fixture.engagementMessages = data.engagementMessages || []
  fixture.engagementReadUnavailable = false
  fixture.engagementAnswerUncertain = false
  fixture.engagementTurns = data.engagementTurns || []
  fixture.allowEngagementAnswer = false
  fixture.chat = {
    getCapabilities: async () => ({ provider: 'openai', default_model_configuration_id: modelId, approved_models: [{ configuration_id: modelId, provider: 'openai', model_id: 'Approved text · offline fixture', display_name: 'Offline configuration' }], answer_readiness: { paid_execution_enabled: fixture.allowEngagementAnswer, spend_tracking_configured: fixture.allowEngagementAnswer, model_price_available: fixture.allowEngagementAnswer ? [{ configuration_id: modelId, fresh_price_available: true }] : [] }, attachments: { supported: false } }),
    getConversation: async (_department, input) => { if (fixture.engagementReadUnavailable) throw failure('Offline recovery temporarily unavailable',503); const row = fixture.engagementConversations.find(row => row.id === input.conversation_id); if (!row || input.engagement_id !== fixture.engagements[0].id || input.project_id !== projectId) throw failure('Foreign engagement fixture request', 404); return { conversation: row, messages: fixture.engagementMessages.filter(message => message.conversation_id === row.id), sharing: { can_manage: false, recipients: [] } } },
    listAttachments: async () => [], listSourceVersions: async () => [], getUnsentDraft: async () => null,
    discardUnsentDraft: async () => ({}),
    saveUnsentDraft: async () => { throw failure('Draft persistence is not exercised in this fixture.', 409) },
    answer: async (_department, input, scope, { onEvent }) => {
      if (!fixture.allowEngagementAnswer || scope.organizationId !== organizationId || scope.signal.aborted || input.engagement_id !== fixture.engagements[0].id || input.project_id !== projectId || (!input.start_new && !fixture.engagementConversations.some(row => row.id === input.conversation_id))) throw failure('Foreign or disabled offline answer request', 403)
      if (input.start_new && fixture.firstSendNoReservation) throw Object.assign(failure('Offline reservation denied before saving',400),{outcome:'not_reserved'})
      if (input.start_new) {
        if (fixture.engagementConversations.some(row => row.id === input.conversation_id) || input.attachment_ids?.length || input.selected_artifact_version_ids?.length) throw failure('Unsafe offline first Send',409)
        fixture.engagementConversations.push({ ...engagementConversation, id: input.conversation_id, title: contextChatTitleFromMessage(input.prompt) })
      }
      if (fixture.engagementTurns.some(turn => turn.client_request_id === input.client_request_id)) throw failure('Duplicate offline request identity', 409)
      fixture.engagementTurns.push(structuredClone(input))
      onEvent({ type: 'started' })
      const answer = 'OFFLINE SAVED ANSWER · ' + input.prompt
      const nextSequence = fixture.engagementMessages.filter(message => message.conversation_id === input.conversation_id).length + 1
      fixture.engagementMessages.push({ id: crypto.randomUUID(), conversation_id: input.conversation_id, client_request_id: input.client_request_id, sequence: nextSequence, role: 'user', body: input.prompt, author_id: actor, status: 'completed', created_at: new Date().toISOString() }, { id: crypto.randomUUID(), conversation_id: input.conversation_id, sequence: nextSequence + 1, role: 'assistant', body: answer, status: 'completed', created_at: new Date().toISOString() })
      data.engagementConversations = fixture.engagementConversations; data.engagementMessages = fixture.engagementMessages; data.engagementTurns = fixture.engagementTurns; save()
      if (fixture.engagementAnswerUncertain) throw failure('Offline first Send response lost',503)
      onEvent({ type: 'completed', answer })
    },

    searchConversations: async (_department, input) => ({ items: fixture.engagementConversations.filter(row => row.title.toLowerCase().includes((input.query || '').toLowerCase())), next_cursor: null }),
    listContextConversations: async input => data.rows.filter(row => row.context_kind === input.context_kind && (row.project_id || '') === (input.project_id || '') && (row.department_id || '') === (input.department_id || '')).slice(input.offset || 0, (input.offset || 0) + 51),
    getContextConversation: async input => {
      const row = data.rows.find(item => item.id === input.conversation_id)
      if (!row) throw failure('Conversation unavailable', 404)
      return { conversation: { ...row }, messages: data.messages.filter(item => item.conversation_id === row.id && (!input.before_sequence || item.sequence < input.before_sequence)).map(item => ({ ...item })), has_older: false }
    },
    startContextConversation: async input => {
      await fixture.beforeStart?.(input)
      let row = data.rows.find(item => item.id === input.conversation_id)
      if (!row) { row = { ...conversation, ...scope, id: input.conversation_id, title: contextChatTitleFromMessage(input.message) }; data.rows.push(row); data.counters.created++; save() }
      const message = append(input)
      if (fixture.createUncertain) { fixture.createUncertain = false; throw failure('Creation response lost · fixture', 503) }
      return { conversation: { ...row }, message }
    },
    appendContextHumanMessage: async input => append(input),
    getContextChatReadiness: async () => fixture.readiness,
    renameContextConversation: async input => { const row = data.rows.find(item => item.id === input.conversation_id); row.title = input.title; save(); return { ...row } },
    getProjectContextSharing: async () => ({ candidates: [], recipients: [] }),
    setProjectContextSharing: async () => ({}),
  }
  fixture.runner = {
    run: async input => {
      data.counters.run++; save(); await fixture.beforeRun?.(input)
      if (fixture.runFailure) throw failure('Reply outcome uncertain · fixture. Check recovery.', 503)
      return reply(input.message_id)
    },
    recover: async messageId => { data.counters.recover++; save(); if (!fixture.recoveryAvailable) throw failure('No settled reply yet · fixture. No provider request was sent.', 409); return reply(messageId) },
  }
  return fixture
}

// Explicit synthetic published sources for the pipeline UI; no publication journey claimed.
export function createPipelinePreviewFixture({declared=false}={}) {
 const website='a0000000-0000-4000-8000-000000000101', marketing='a0000000-0000-4000-8000-000000000102', preset='a0000000-0000-4000-8000-000000000103', marketingPreset='a0000000-0000-4000-8000-000000000104'
 const records={available:[],publishedDefinitions:[{id:'a0000000-0000-4000-8000-000000000105',definition:{name:'Website delivery',version_number:1,preset_publication_id:preset,steps:[]}},{id:'a0000000-0000-4000-8000-000000000106',definition:{name:'Campaign delivery',version_number:1,preset_publication_id:marketingPreset,steps:[]}}],groups:[{id:website,name:'Main website',kind:'website',preset_publication_id:preset},{id:marketing,name:'Launch campaign',kind:'marketing',preset_publication_id:marketingPreset}],configurations:[{id:'legacy',revision:9,selected_steps:[{key:'original_brief',quantity:1}],max_ai_cost_microusd:0},{id:'web',pipeline_group_id:website,revision:10,group_revision:2,selected_steps:[{key:'page_brief',quantity:4}],max_ai_cost_microusd:0},{id:'mkt',pipeline_group_id:marketing,revision:11,group_revision:3,selected_steps:[{key:'campaign_plan',quantity:1}],max_ai_cost_microusd:0}],activations:[{configuration_id:'mkt',pipeline_group_id:marketing,activation_number:11,group_activation_number:3},{configuration_id:'legacy',activation_number:9},{configuration_id:'web',pipeline_group_id:website,activation_number:10,group_activation_number:2}]}
 records.publishedDefinitions[0].definition.steps=[{key:'page_brief',label:'Page brief',kind:'human',department_id:'content',service_id:preset,depends_on:[]},{key:'page_copy',label:'Page copy',kind:'human',department_id:'content',service_id:preset,depends_on:['page_brief']}]
 const artifact={artifact_id:'a0000000-0000-4000-8000-000000000107',artifact_version_id:'a0000000-0000-4000-8000-000000000108',version_number:2,title:'Approved launch source',artifact_type:'content',output_type:'blog_article',ai_use_allowed:false,approval_id:'a0000000-0000-4000-8000-000000000109',content_checksum:'a'.repeat(64)}
 if(declared){
  records.publishedDefinitions[0].definition.steps[0].stage_contract={optional:false,output_label:'Approved launch article',reuse_allowed:true,artifact_type:'content',output_type:'blog_article',required_inputs:[{key:'audience',label:'Audience',kind:'manual'}]}
  records.publishedDefinitions[0].definition.steps[1].stage_contract={optional:false,output_label:'Page copy',reuse_allowed:false,required_inputs:[{key:'article',label:'Approved source article',kind:'approved_artifact',artifact_type:'content',output_type:'blog_article'}]}
  records.publishedDefinitions[0].definition.steps.push({key:'extra_proof',label:'Additional proof',kind:'human',department_id:'content',service_id:preset,depends_on:['page_brief'],stage_contract:{optional:true,output_label:'Additional proof notes',reuse_allowed:false,required_inputs:[]}})
 }
 const definitionRecords={definitions:[],approvals:[],publications:[]},definitionCalls=[]
 const definitionRepository={list:async()=>structuredClone(definitionRecords),create:async input=>{definitionCalls.push(structuredClone(input));const row={id:crypto.randomUUID(),organization_id:organizationId,created_by:actor,request_id:input.requestId,preset_publication_id:input.presetPublicationId,name:input.name,steps:input.steps,steps_sha256:'a'.repeat(64),version_number:definitionRecords.definitions.length+1};definitionRecords.definitions.push(row);return {definition_id:row.id,version_number:row.version_number}},approve:async()=>{throw new Error('Actual head approval is not mocked as acceptance')},publish:async()=>{throw new Error('Actual publication is not mocked as acceptance')}}
 const definitionCatalog={publications:[{id:preset,pipeline_template_version_id:preset}],versions:[{id:preset,name:'Website',version_number:1}],selections:[{pipeline_template_version_id:preset,service_id:preset}]}
 const definitionServices=[{id:preset,name:'Content',department_id:'content',is_active:true}]
 const services=[{service_id:preset,status:'active'}]
 const calls=[],runCalls=[],configCalls=[],rows=[]
 return {records,calls,runCalls,configCalls,runRows:rows,services,artifact,website,marketing,definitionCatalog,definitionServices,definitionRecords,definitionCalls,definitionRepository,repository:{listStageArtifacts:async()=>({artifacts:[structuredClone(artifact)],offset:0,has_more:false}),create:async input=>{configCalls.push(structuredClone(input));const row={id:crypto.randomUUID(),request_id:input.requestId,configured_by:actor,pipeline_group_id:input.pipelineGroupId,revision:12,group_revision:1,selected_steps:input.selectedSteps,max_ai_cost_microusd:input.maxAiCostMicrousd,stage_review:input.stageDecisions ? {id:crypto.randomUUID(),decisions:input.stageDecisions} : null};records.configurations.push(row);return row},list:async()=>structuredClone(records),listGroups:async()=>structuredClone(records.groups),createGroup:async input=>{calls.push(input);const group={id:crypto.randomUUID(),created_by:actor,request_id:input.requestId,preset_publication_id:input.presetPublicationId,kind:input.kind,name:input.name};records.groups.push(group);return {group}}},runRepository:{list:async()=>structuredClone(rows),findRequest:async input=>rows.find(row=>row.request_id===input.requestId && row.requested_by===input.actorId)||null,start:async input=>{runCalls.push(input);const row={id:crypto.randomUUID(),request_id:input.requestId,requested_by:actor,pipeline_group_id:input.pipelineGroupId,status:'awaiting_review',requested_at:new Date().toISOString(),input_sha256:'a'.repeat(64),input_manifest:{pipeline:{version_id:input.pipelineGroupId===marketing ? marketingPreset : preset},assets:[]}};rows.push(row);return {run_intent_id:row.id}}}}
}

export function createWebsitePagePreviewFixture(){
 const projectId='a0000000-0000-4000-8000-000000000201',engagementId='a0000000-0000-4000-8000-000000000202',versionId='a0000000-0000-4000-8000-000000000203',rootId='a0000000-0000-4000-8000-000000000204',approvalId='a0000000-0000-4000-8000-000000000205'
 const reference={artifact_id:rootId,artifact_version_id:versionId,version_number:2,content_checksum:'a'.repeat(64),approval_id:approvalId,ai_use_allowed:false}
 const rows=Array.from({length:101},(_,n)=>({source:{page_key:'page:'+(n+1),path:n===0 ? 'welcome' : 'services/page-'+(n+1),title:n===0 ? 'Welcome' : 'Service page '+(n+1),page_type:n===0 ? 'hub' : 'supporting',parent_page_key:n===0 ? null : 'page:1'},page_id:n===0 ? 'a0000000-0000-4000-8000-000000000206' : null,initial_path:n===0 ? 'home' : 'services/page-'+(n+1),operations:n===0 ? {publication_state:'published',recorded_live_url:'https://example.invalid/home'} : null,owner_id:n===0 ? actor : null,due_date:n===0 ? '2026-10-10' : null,work_state:n===0 ? 'current' : 'unlinked',tracked_page_id:n===0 ? 'a0000000-0000-4000-8000-000000000207' : null}))
 const calls=[],reads=[],operations=new Map();let lost=false,gate=null,release
 const repository={
  async list(input){reads.push(structuredClone(input));const filtered=rows.filter(row=>(!input.search || (row.source.title+' '+row.source.path).toLowerCase().includes(input.search.toLowerCase())) && (!input.publicationState || (row.operations?.publication_state || 'planned')===input.publicationState) && (!input.parentPageKey || row.source.parent_page_key===input.parentPageKey));return structuredClone({reference,counts:{total:101,registered:rows.filter(row=>row.page_id).length,published:1,in_progress:0,planned:100,linked_seo:1,assigned:1,has_deadline:1,filtered_total:filtered.length},pages:filtered.slice(input.offset || 0,(input.offset || 0)+(input.limit || 25))})},
  async preview(input){reads.push({preview:structuredClone(input)});return {reference,review_sha256:'b'.repeat(64),pages:input.pageKeys.map(key=>{const row=rows.find(item=>item.source.page_key===key);return {...row.source,registered_page_id:row.page_id,initial_path:row.initial_path}})}},
  async register(input){calls.push(structuredClone(input));if(gate)await gate;const result={pages:input.pageKeys.map((key,n)=>{const row=rows.find(item=>item.source.page_key===key);row.page_id ||= 'a0000000-0000-4000-8000-'+String(n+300).padStart(12,'0');return {page_id:row.page_id,page_key:key}}),source_version_id:versionId};operations.set(input.requestId,{command_kind:'register',result});if(lost)throw new Error('Lost response to original page registration');return result},
  async recover(input){reads.push({recover:structuredClone(input)});return operations.get(input.requestId)||null},
  async history(input){reads.push({history:structuredClone(input)});const row=rows.find(item=>item.page_id===input.pageId);return {page:{page_key:row.source.page_key,initial_path:row.initial_path},revisions:[{id:'fixture-revision-2',revision_number:2,planned_path:'welcome',publication_state:'published',recorded_live_url:'https://example.invalid/home',redirect_url:'https://example.invalid/welcome',architecture_version_id:versionId},{id:'fixture-revision-1',revision_number:1,planned_path:'home',publication_state:'in_progress',recorded_live_url:null,architecture_version_id:versionId}],seo_links:[{id:'fixture-explicit-link'}]}},
 }
 return {repository,sourceRepository:{listStageArtifacts:async()=>({artifacts:[{...reference,title:'Approved 101-page architecture',artifact_type:'website_architecture'}],offset:0,has_more:false})},rows,calls,reads,projectId,engagementId,versionId,group:{id:'a0000000-0000-4000-8000-000000000208',kind:'website',name:'Main Website'},setLost(value=true){lost=value},setGate(){gate=new Promise(done=>{release=done})},release(){release?.();gate=null}}
}
