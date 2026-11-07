import { useState } from 'react'
import DirectContextChat from '../src/components/DirectContextChat.jsx'
import { actor, organizationId, createProjectNavigationPreviewFixture } from './direct-chat-fixture.js'

const wording = 'Our example studio helps neighborhood shops explain their services.'
export function createPositioningPreview(fixture) {
  const workspace = createProjectNavigationPreviewFixture(fixture.scope.project_id).workspace
  const conversation = fixture.data.rows[0]
  const output = {
    version_id: 'b0000000-0000-4000-8000-000000000001', version_number: 1,
    binding_id: 'b0000000-0000-4000-8000-000000000002',
    wording_sha256: '153a7370f58f473a4ca26df78e27342a5a8cb4a9583f03ebb000f206fae5b370', conversation_id: conversation.id,
  }
  const prev = globalThis.__allowanceFixture
  globalThis.__allowanceFixture = { ...prev, rpc(name, args) {
    if (name !== 'read_project_positioning_output') return prev?.rpc?.(name,args) ?? { data:null, error:{message:'Unavailable in local fixture'} }
    if (args.p_organization_id !== organizationId || args.p_project_id !== workspace.project.id ||
      args.p_engagement_id !== workspace.engagement.id || args.p_conversation_id !== conversation.id || args.p_version_id !== output.version_id) {
      return {error:{message:'Unknown local positioning version'}}
    }
    return {data:{organization_id:organizationId, project_id:workspace.project.id, engagement_id:workspace.engagement.id,
      actor_id:actor, binding_id:output.binding_id, current:output, selected:{...output,wording}}}
  }}
  return {workspace, conversation, output}
}

export default function PositioningSendPreview({ scenario, signal }) {
  const {workspace,conversation,output} = scenario
  const [selection,setSelection] = useState(null)
  return <main className="workspace-page"><h1>Product and service structure</h1>
    <p>Local test account · Sample positioning version 1 · Simulated reply</p>
    <button onClick={()=>setSelection({selectionId:crypto.randomUUID(), actorId:actor, organizationId,
      projectId:workspace.project.id, engagementId:workspace.engagement.id, output})}>Continue with sample positioning</button>
    <DirectContextChat systemOwner contextKind="project_team" projectId={workspace.project.id} label="Local Project Chat"
      organizationId={organizationId} user={{id:actor}} signal={signal} initialConversation={conversation}
      projectJourney={workspace} productStructureSelection={selection} onProductStructureSelectionConsumed={()=>setSelection(null)} />
  </main>
}
