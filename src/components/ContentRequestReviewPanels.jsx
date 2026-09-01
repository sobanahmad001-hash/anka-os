import VersionProofingPanel from './VersionProofingPanel.jsx'
import ArtifactRelationsPanel from './ArtifactRelationsPanel.jsx'

export default function ContentRequestReviewPanels({ request }) {
  if (!request?.id || !request?.organization_id) return null

  return <section className="mt-5 space-y-3">
    <VersionProofingPanel
      targetKind="content_request"
      versions={[{ id: request.id, version_number: 1 }]}
      initialVersionId={request.id}
      department="content"
      theme="amber"
    />
    <ArtifactRelationsPanel requestContext={{ id: request.id, organizationId: request.organization_id }} />
  </section>
}