function required(value, label) {
  if (!value || typeof value !== 'string') throw new TypeError(`${label} is required`)
}

async function rpc(client, name, args) {
  if (!client?.rpc) throw new TypeError('A Supabase RPC client is required')
  const { data, error, status } = await client.rpc(name, args)
  if (error) {
    const failure = new Error(error.message || 'Governed deliverable action failed')
    failure.cause = error
    failure.status = status ?? error.status ?? error.statusCode
    failure.code = error.code
    throw failure
  }
  return data
}

const requestId = (value) => value || crypto.randomUUID()

export function createDeliverableGovernance(client) {
  return Object.freeze({
    capabilities(organizationId, deliverableVersionId) {
      required(organizationId, 'organizationId')
      required(deliverableVersionId, 'deliverableVersionId')
      return rpc(client, 'get_deliverable_version_capabilities', {
        p_organization_id: organizationId,
        p_deliverable_version_id: deliverableVersionId,
      })
    },
    reviewerCandidates(organizationId, deliverableVersionId) {
      required(organizationId, 'organizationId')
      required(deliverableVersionId, 'deliverableVersionId')
      return rpc(client, 'list_deliverable_reviewer_candidates', {
        p_organization_id: organizationId,
        p_deliverable_version_id: deliverableVersionId,
      })
    },
    create(input) {
      required(input?.organizationId, 'organizationId')
      required(input?.deliverableId, 'deliverableId')
      required(input?.title, 'title')
      return rpc(client, 'create_governed_deliverable_version', {
        p_organization_id: input.organizationId,
        p_deliverable_id: input.deliverableId,
        p_title: input.title.trim(),
        p_change_summary: input.changeSummary?.trim() || '',
        p_file_id: input.fileId || null,
        p_preview_metadata: input.previewUrl ? { preview_url: input.previewUrl.trim() } : {},
        p_client_approval_required: Boolean(input.clientApprovalRequired),
        p_request_id: requestId(input.requestId),
      })
    },
    submit(input) {
      return rpc(client, 'submit_governed_deliverable_version', {
        p_organization_id: input.organizationId,
        p_deliverable_version_id: input.deliverableVersionId,
        p_expected_state_version: input.expectedStateVersion,
        p_nominated_reviewer_id: input.reviewerId,
        p_request_id: requestId(input.requestId),
      })
    },
    assignReviewer(input) {
      return rpc(client, 'assign_governed_deliverable_reviewer', {
        p_organization_id: input.organizationId,
        p_deliverable_version_id: input.deliverableVersionId,
        p_expected_state_version: input.expectedStateVersion,
        p_reviewer_id: input.reviewerId,
        p_reason: input.reason?.trim() || '',
        p_request_id: requestId(input.requestId),
      })
    },
    review(input) {
      return rpc(client, 'review_governed_deliverable_version', {
        p_organization_id: input.organizationId,
        p_deliverable_version_id: input.deliverableVersionId,
        p_expected_state_version: input.expectedStateVersion,
        p_decision: input.decision,
        p_rationale: input.rationale?.trim() || '',
        p_checklist_result: input.checklistResult || {},
        p_request_id: requestId(input.requestId),
      })
    },
    release(input) {
      return rpc(client, 'release_governed_deliverable_version', {
        p_organization_id: input.organizationId,
        p_deliverable_version_id: input.deliverableVersionId,
        p_expected_state_version: input.expectedStateVersion,
        p_client_approval_required: Boolean(input.clientApprovalRequired),
        p_next_action: input.nextAction?.trim() || '',
        p_request_id: requestId(input.requestId),
      })
    },
    clientDecision(input) {
      return rpc(client, 'decide_governed_deliverable_version', {
        p_organization_id: input.organizationId,
        p_deliverable_version_id: input.deliverableVersionId,
        p_expected_state_version: input.expectedStateVersion,
        p_decision: input.decision,
        p_rationale: input.rationale?.trim() || '',
        p_request_id: requestId(input.requestId),
      })
    },
    delivered(input) {
      return rpc(client, 'mark_governed_deliverable_delivered', {
        p_organization_id: input.organizationId,
        p_deliverable_version_id: input.deliverableVersionId,
        p_expected_state_version: input.expectedStateVersion,
        p_metadata: input.metadata || {},
        p_request_id: requestId(input.requestId),
      })
    },
    published(input) {
      return rpc(client, 'mark_governed_deliverable_published', {
        p_organization_id: input.organizationId,
        p_deliverable_version_id: input.deliverableVersionId,
        p_expected_state_version: input.expectedStateVersion,
        p_metadata: input.metadata || {},
        p_request_id: requestId(input.requestId),
      })
    },
  })
}
