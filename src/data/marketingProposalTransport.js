export async function invokeMarketingProposal(client, organizationId, action, input = {}, { signal } = {}) {
  const { engagement_stage_instance_id: _ignoredStage, ...body } = input
  const { data, error } = await client.functions.invoke('department-chat', {
    body: { ...body, action, organization_id: organizationId, department_id: 'marketing' }, signal,
  })
  if (error) throw Object.assign(new Error(error.message || 'Department Chat function failed'), {
    status: error.status ?? error.statusCode ?? error.context?.status,
  })
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export function createMarketingProposalTransport(client, organizationId, options = {}) {
  return Object.freeze({
    proposeArtifact: input => invokeMarketingProposal(client, organizationId, 'propose_artifact', input, options),
    proposeWorkItem: input => invokeMarketingProposal(client, organizationId, 'propose_work_item', input, options),
  })
}
