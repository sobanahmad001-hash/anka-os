export const OPERATING_DEPARTMENTS = Object.freeze([
  Object.freeze({ id: 'content', name: 'Content' }),
  Object.freeze({ id: 'design', name: 'Design' }),
  Object.freeze({ id: 'development', name: 'Development' }),
  Object.freeze({ id: 'marketing', name: 'Marketing' }),
])

const DEVELOPMENT_ARTIFACT_TYPES = Object.freeze(['technical_brief', 'launch_checklist'])

export function pipelineDepartmentFlags(services = []) {
  const activeDepartments = new Set(
    services
      .filter((service) => service.status === 'active')
      .map((service) => service.service_catalog?.department_id)
      .filter(Boolean)
  )
  return Object.freeze({
    content: activeDepartments.has('content'),
    design: activeDepartments.has('design'),
    marketing: activeDepartments.has('marketing'),
  })
}
function required(value, label) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} is required`)
  }
}

async function dataOrThrow(query, signal) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const response = await query
  const { data, error } = response
  if (error) {
    throw Object.assign(new Error(error.message || 'Operating Spine query failed'), {
      status: response.status ?? error.status,
      code: error.code,
    })
  }
  return data
}

export function createOperatingSpineRepository(client) {
  if (!client?.from || !client?.rpc) {
    throw new TypeError('A Supabase-compatible client is required')
  }

  async function organizationContext(userId, organizationId, signal) {
    required(userId, 'userId')
    required(organizationId, 'organizationId')
    const membership = await dataOrThrow(
      client.from('organization_memberships')
        .select('organization_id, role, department_id')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .eq('member_kind', 'team')
        .eq('status', 'active')
        .maybeSingle(),
      signal
    )
    if (!membership) throw Object.assign(new Error('Active organization membership is required'), { status: 403 })
    return membership
  }

  return Object.freeze({
    organizationContext,

    async listClientsAndBrands(organizationId, { signal } = {}) {
      required(organizationId, 'organizationId')
      return dataOrThrow(
        client.from('agency_clients')
          .select('*, brands(*)')
          .eq('organization_id', organizationId)
          .order('name'),
        signal
      )
    },

    async createClient(input, userId, organizationId, { signal } = {}) {
      required(input?.name, 'Client name')
      required(input?.brandName, 'Brand name')
      required(userId, 'userId')
      required(organizationId, 'organizationId')
      return dataOrThrow(
        client.rpc('create_commercial_client', {
          p_organization_id: organizationId,
          p_name: input.name.trim(),
          p_brand_name: input.brandName.trim(),
          p_legal_name: input.legalName?.trim() || input.name.trim(),
          p_primary_email: input.primaryEmail?.trim() || null,
          p_website_url: input.websiteUrl?.trim() || null,
          p_industry: input.industry?.trim() || '',
          p_brand_description: input.brandDescription?.trim() || '',
          p_brand_website_url: input.brandWebsiteUrl?.trim() || input.websiteUrl?.trim() || null,
        }),
        signal
      )
    },

    async createBrand(input, userId, organizationId, { signal } = {}) {
      required(input?.clientId, 'Client')
      required(input?.name, 'Brand name')
      const membership = await organizationContext(userId, organizationId, signal)
      const parentClient = await dataOrThrow(
        client.from('agency_clients').select('id')
          .eq('id', input.clientId)
          .eq('organization_id', organizationId)
          .eq('status', 'active')
          .maybeSingle(),
        signal
      )
      if (!parentClient) throw Object.assign(new Error('Client is unavailable in the active organization'), { status: 403 })
      return dataOrThrow(
        client.from('brands').insert({
          organization_id: membership.organization_id,
          client_id: input.clientId,
          name: input.name.trim(),
          description: input.description?.trim() || '',
          website_url: input.websiteUrl?.trim() || null,
          status: 'active',
          is_default: false,
          created_by: userId,
        }).select().single(),
        signal
      )
    },

    async listServices(organizationId, { signal } = {}) {
      required(organizationId, 'organizationId')
      return dataOrThrow(
        client.from('service_catalog')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('is_active', true)
          .order('display_order'),
        signal
      )
    },

    async listOwners(organizationId, { signal } = {}) {
      required(organizationId, 'organizationId')
      const memberships = await dataOrThrow(
        client.from('organization_memberships')
          .select('user_id, role, department_id')
          .eq('organization_id', organizationId)
          .eq('member_kind', 'team')
          .eq('status', 'active'),
        signal
      )
      const userIds = [...new Set((memberships || []).map(item => item.user_id).filter(Boolean))]
      if (!userIds.length) return []
      const profiles = await dataOrThrow(
        client.from('profiles').select('id, full_name, email, department, role').in('id', userIds),
        signal
      )
      const profileById = new Map((profiles || []).map(profile => [profile.id, profile]))
      return (memberships || []).map(membership => ({
        ...membership,
        profile: profileById.get(membership.user_id) || null,
      }))
    },

    async composeEngagement(input, organizationId, { signal } = {}) {
      required(input?.clientId, 'Client')
      required(input?.brandId, 'Brand')
      required(input?.name, 'Engagement name')
      required(organizationId, 'organizationId')
      if (!Array.isArray(input.serviceIds) || !input.serviceIds.length) {
        throw new TypeError('At least one service is required')
      }
      const brand = await dataOrThrow(
        client.from('brands').select('id')
          .eq('id', input.brandId)
          .eq('client_id', input.clientId)
          .eq('organization_id', organizationId)
          .eq('status', 'active')
          .maybeSingle(),
        signal
      )
      if (!brand) throw Object.assign(new Error('Client and brand are unavailable in the active organization'), { status: 403 })
      const data = await dataOrThrow(
        client.rpc('compose_engagement', {
          p_client_id: input.clientId,
          p_brand_id: input.brandId,
          p_name: input.name.trim(),
          p_engagement_type: input.engagementType || 'project',
          p_service_ids: [...new Set(input.serviceIds)],
          p_lead_owner_id: input.leadOwnerId || null,
          p_service_owners: input.serviceOwners || {},
          p_start_date: input.startDate || null,
          p_target_date: input.targetDate || null,
          p_objective: input.objective?.trim() || '',
          p_existing_assets: (input.existingAssets || []).filter(asset => asset.asset_kind && asset.name),
        }),
        signal
      )
      return data
    },

    async listEngagements(organizationId, { signal } = {}) {
      required(organizationId, 'organizationId')
      return dataOrThrow(
        client.from('engagements')
          .select('*, agency_clients(name), brands(name), engagement_services(id, status, service_catalog(id, name, department_id))')
          .eq('organization_id', organizationId)
          .order('updated_at', { ascending: false }),
        signal
      )
    },

    async getPortfolioSnapshot(organizationId, { signal } = {}) {
      required(organizationId, 'organizationId')
      const queries = [
        client.from('engagements')
          .select('id, organization_id, client_id, brand_id, name, engagement_type, status, lead_owner_id, start_date, target_date, agency_clients(name), brands(name)')
          .eq('organization_id', organizationId)
          .order('target_date', { ascending: true, nullsFirst: false })
          .order('name'),
        client.from('work_items')
          .select('id, organization_id, engagement_id, status, automation_flagged_at, deleted_at')
          .eq('organization_id', organizationId)
          .is('deleted_at', null),
        client.from('engagement_stage_instances')
          .select('id, organization_id, engagement_id, status')
          .eq('organization_id', organizationId),
      ]
      const [engagements, workItems, stages] = await Promise.all(
        queries.map(query => dataOrThrow(query, signal))
      )
      return { engagements, workItems, stages }
    },

    async getEngagement(engagementId, organizationId, { signal } = {}) {
      required(engagementId, 'engagementId')
      required(organizationId, 'organizationId')
      const [
        engagement,
        services,
        stages,
        dependencies,
        prerequisites,
        assets,
        events,
        connectors,
        developmentArtifacts,
        developmentArtifactVersions,
        artifactApprovals,
        workItemArtifacts,
        workItemArtifactVersions,
        contentRequests,
        workItems,
        designSessions,
      ] = await Promise.all([
        client.from('engagements').select('*, agency_clients(*), brands(*)').eq('id', engagementId).eq('organization_id', organizationId).single(),
        client.from('engagement_services').select('*, service_catalog(*)').eq('organization_id', organizationId).eq('engagement_id', engagementId).order('activated_at'),
        client.from('engagement_stage_instances').select('*').eq('organization_id', organizationId).eq('engagement_id', engagementId).order('position'),
        client.from('engagement_stage_dependencies').select('*').eq('organization_id', organizationId).eq('engagement_id', engagementId),
        client.from('engagement_prerequisites').select('*').eq('organization_id', organizationId).eq('engagement_id', engagementId).order('recorded_at'),
        client.from('engagement_assets').select('*').eq('organization_id', organizationId).eq('engagement_id', engagementId).order('created_at'),
        client.from('engagement_events').select('*').eq('organization_id', organizationId).eq('engagement_id', engagementId).order('occurred_at'),
        client.from('integration_connection_engagements').select('*, integration_connections(provider, display_name, status)').eq('organization_id', organizationId).eq('engagement_id', engagementId),
        client.from('artifacts').select('*').eq('organization_id', organizationId).eq('engagement_id', engagementId).in('artifact_type', DEVELOPMENT_ARTIFACT_TYPES).order('created_at'),
        client.from('artifact_versions').select('*, artifacts!inner(engagement_id, artifact_type)').eq('organization_id', organizationId).eq('artifacts.engagement_id', engagementId).in('artifacts.artifact_type', DEVELOPMENT_ARTIFACT_TYPES).order('version_number'),
        client.from('artifact_approvals').select('*').eq('organization_id', organizationId).eq('engagement_id', engagementId).order('approved_at'),
        client.from('artifacts').select('*').eq('organization_id', organizationId).eq('engagement_id', engagementId).order('created_at'),
        client.from('artifact_versions').select('*, artifacts!inner(engagement_id)').eq('organization_id', organizationId).eq('artifacts.engagement_id', engagementId).order('version_number'),
        client.from('content_requests').select('id, organization_id, engagement_id, brand_id, mode, status, output_path, format, brief, created_at, queue_entry_id, linked_event_id').eq('organization_id', organizationId).eq('engagement_id', engagementId).order('created_at', { ascending: false }),
        client.from('work_items').select('id, title, status, priority, department_id, linked_engagement_stage_instance_id, assignee_id, created_at').eq('organization_id', organizationId).eq('engagement_id', engagementId).is('deleted_at', null).order('position'),
        client.from('design_workshop_sessions').select('id').eq('organization_id', organizationId).eq('engagement_id', engagementId).order('created_at', { ascending: false }),
      ].map(query => dataOrThrow(query, signal)))

      const queueEntryIds = contentRequests.map((request) => request.queue_entry_id).filter(Boolean)
      const queueEntries = queueEntryIds.length
        ? await dataOrThrow(client.from('content_queue_entries')
          .select('id, organization_id, brand_id, planned_date, format, status, brief_template, linked_event_id, fulfilled_by_request_id')
          .eq('organization_id', organizationId)
          .in('id', queueEntryIds)
          .order('planned_date', { ascending: false })
          .order('created_at', { ascending: false }), signal)
        : []

      const designDirectionIds = designSessions.length ? designSessions.map((session) => session.id) : []
      const designDirectionRows = designDirectionIds.length
        ? await dataOrThrow(client.from('design_directions').select('id').eq('organization_id', organizationId).in('session_id', designDirectionIds), signal)
        : []
      const directionIds = designDirectionRows.map((direction) => direction.id)
      const designDirectionVersions = directionIds.length
        ? await dataOrThrow(client.from('design_direction_versions').select('id').eq('organization_id', organizationId).in('direction_id', directionIds), signal)
        : []
      const designDirectionVersionIds = designDirectionVersions.map((version) => version.id)
      const pageDesigns = designDirectionVersionIds.length
        ? await dataOrThrow(client.from('website_page_designs')
          .select('id, organization_id, design_direction_version_id, slug, status, created_at, updated_at')
          .eq('organization_id', organizationId)
          .in('design_direction_version_id', designDirectionVersionIds)
          .order('created_at', { ascending: false }), signal)
        : []
      const designExportJobs = pageDesigns.length
        ? await dataOrThrow(client.from('wordpress_export_jobs')
          .select('id, website_page_design_id, status, provider, requested_at, completed_at, failure_reason')
          .eq('organization_id', organizationId)
          .in('website_page_design_id', pageDesigns.map((item) => item.id))
          .order('requested_at', { ascending: false }), signal)
        : []

      return {
        engagement, services, stages, dependencies, prerequisites, assets, events, connectors,
        developmentArtifacts, developmentArtifactVersions, artifactApprovals, workItemArtifacts, workItemArtifactVersions,
        pipeline: {
          contentRequests,
          contentQueueEntries: queueEntries,
          workItems,
          design: {
            pageDesigns,
            wordpressExportJobs: designExportJobs,
          },
        },
      }
    },
  })
}
