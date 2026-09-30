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
      if (input.private_conversation_id !== threadId || input.direction_version_id || scope.department_id !== 'design') throw failure('Foreign video brief fixture',403)
      fixture.briefReads.push(structuredClone(input))
      const version = input.operation_key ? data.videoBriefVersions.find(row=>row.operation_key===input.operation_key) : data.videoBriefVersions.at(-1)
      return version ? {brief:structuredClone(data.videoBriefRoot),version:structuredClone(version)} : {}
    },
    confirmVideoBrief: async input => {
      if (input.private_conversation_id !== threadId || input.direction_version_id || scope.department_id !== 'design') throw failure('Foreign video brief confirmation',403)
      const existing = data.videoBriefVersions.find(row=>row.operation_key===input.operation_key)
      if(existing) { if(JSON.stringify(existing.fixture_input)!==JSON.stringify(input))throw failure('Changed fixture brief operation',409);return {brief:structuredClone(data.videoBriefRoot),version:structuredClone(existing)} }
      if((input.creative_brief_id||null)!==(data.videoBriefRoot?.id||null) || input.expected_revision!==(data.videoBriefRoot?.revision||0))throw failure('Stale exact fixture brief revision',409)
      const id=crypto.randomUUID(),parent=data.videoBriefVersions.at(-1)
      data.videoBriefRoot={id:data.videoBriefRoot?.id||crypto.randomUUID(),organization_id:organizationId,created_by:actor,visibility:'private',revision:(data.videoBriefRoot?.revision||0)+2,frozen_version_id:id}
      const version={id,creative_brief_id:data.videoBriefRoot.id,organization_id:organizationId,created_by:actor,version_number:data.videoBriefVersions.length+1,parent_version_id:parent?.id||null,operation_key:input.operation_key,fixture_input:structuredClone(input),validation_snapshot:{valid:true,video_confirmation:{action:'confirm_video_brief',actor_id:actor,expected_revision:input.expected_revision,requested_root_id:input.creative_brief_id}},content:videoBriefCreativeContent(input.video_brief,{private_conversation_id:threadId})}
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
export function createPipelinePreviewFixture() {
 const website='a0000000-0000-4000-8000-000000000101', marketing='a0000000-0000-4000-8000-000000000102', preset='a0000000-0000-4000-8000-000000000103', marketingPreset='a0000000-0000-4000-8000-000000000104'
 const records={available:[],publishedDefinitions:[{id:'web-definition',definition:{name:'Website delivery',version_number:1,preset_publication_id:preset,steps:[]}},{id:'marketing-definition',definition:{name:'Campaign delivery',version_number:1,preset_publication_id:marketingPreset,steps:[]}}],groups:[{id:website,name:'Main website',kind:'website',preset_publication_id:preset},{id:marketing,name:'Launch campaign',kind:'marketing',preset_publication_id:marketingPreset}],configurations:[{id:'legacy',revision:9,selected_steps:[{key:'original_brief',quantity:1}],max_ai_cost_microusd:0},{id:'web',pipeline_group_id:website,revision:10,group_revision:2,selected_steps:[{key:'page_brief',quantity:4}],max_ai_cost_microusd:0},{id:'mkt',pipeline_group_id:marketing,revision:11,group_revision:3,selected_steps:[{key:'campaign_plan',quantity:1}],max_ai_cost_microusd:0}],activations:[{configuration_id:'mkt',pipeline_group_id:marketing,activation_number:11,group_activation_number:3},{configuration_id:'legacy',activation_number:9},{configuration_id:'web',pipeline_group_id:website,activation_number:10,group_activation_number:2}]}
 const calls=[],runCalls=[],rows=[]
 return {records,calls,runCalls,website,marketing,repository:{list:async()=>structuredClone(records),listGroups:async()=>structuredClone(records.groups),createGroup:async input=>{calls.push(input);const group={id:crypto.randomUUID(),created_by:actor,request_id:input.requestId,preset_publication_id:input.presetPublicationId,kind:input.kind,name:input.name};records.groups.push(group);return {group}}},runRepository:{list:async()=>structuredClone(rows),findRequest:async input=>rows.find(row=>row.request_id===input.requestId && row.requested_by===input.actorId)||null,start:async input=>{runCalls.push(input);const row={id:crypto.randomUUID(),request_id:input.requestId,requested_by:actor,pipeline_group_id:input.pipelineGroupId,status:'awaiting_review',requested_at:new Date().toISOString(),input_sha256:'a'.repeat(64),input_manifest:{pipeline:{version_id:input.pipelineGroupId===marketing ? marketingPreset : preset},assets:[]}};rows.push(row);return {run_intent_id:row.id}}}}
}
