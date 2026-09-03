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

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Operating Spine query failed')
  return data
}

export function createOperatingSpineRepository(client) {
  if (!client?.from || !client?.rpc) {
    throw new TypeError('A Supabase-compatible client is required')
  }

  async function organizationContext(userId) {
    required(userId, 'userId')
    return dataOrThrow(
      client.from('organization_memberships')
        .select('organization_id, role, department_id')
        .eq('user_id', userId)
        .eq('member_kind', 'team')
        .eq('status', 'active')
        .limit(1)
        .single()
    )
  }

  return Object.freeze({
    organizationContext,

    async listClientsAndBrands() {
      return dataOrThrow(
        client.from('agency_clients')
          .select('*, brands(*)')
          .order('name')
      )
    },

    async createClient(input, userId) {
      required(input?.name, 'Client name')
      required(input?.brandName, 'Brand name')
      required(userId, 'userId')
      return dataOrThrow(
        client.rpc('create_commercial_client', {
          p_name: input.name.trim(),
          p_brand_name: input.brandName.trim(),
          p_legal_name: input.legalName?.trim() || input.name.trim(),
          p_primary_email: input.primaryEmail?.trim() || null,
          p_website_url: input.websiteUrl?.trim() || null,
          p_industry: input.industry?.trim() || '',
          p_brand_description: input.brandDescription?.trim() || '',
          p_brand_website_url: input.brandWebsiteUrl?.trim() || input.websiteUrl?.trim() || null,
        })
      )
    },

    async createBrand(input, userId) {
      required(input?.clientId, 'Client')
      required(input?.name, 'Brand name')
      const membership = await organizationContext(userId)
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
        }).select().single()
      )
    },

    async listServices() {
      return dataOrThrow(
        client.from('service_catalog')
          .select('*')
          .eq('is_active', true)
          .order('display_order')
      )
    },

    async listOwners() {
      const memberships = await dataOrThrow(
        client.from('organization_memberships')
          .select('user_id, role, department_id')
          .eq('member_kind', 'team')
          .eq('status', 'active')
      )
      const userIds = [...new Set((memberships || []).map(item => item.user_id).filter(Boolean))]
      if (!userIds.length) return []
      const profiles = await dataOrThrow(
        client.from('profiles').select('id, full_name, email, department, role').in('id', userIds)
      )
      const profileById = new Map((profiles || []).map(profile => [profile.id, profile]))
      return (memberships || []).map(membership => ({
        ...membership,
        profile: profileById.get(membership.user_id) || null,
      }))
    },

    async composeEngagement(input) {
      required(input?.clientId, 'Client')
      required(input?.brandId, 'Brand')
      required(input?.name, 'Engagement name')
      if (!Array.isArray(input.serviceIds) || !input.serviceIds.length) {
        throw new TypeError('At least one service is required')
      }
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
        })
      )
      return data
    },

    async listEngagements() {
      return dataOrThrow(
        client.from('engagements')
          .select('*, agency_clients(name), brands(name), engagement_services(id, status, service_catalog(id, name, department_id))')
          .order('updated_at', { ascending: false })
      )
    },

    async getPortfolioSnapshot() {
      const [engagements, workItems, stages] = await Promise.all([
        dataOrThrow(
          client.from('engagements')
            .select('id, organization_id, client_id, brand_id, name, engagement_type, status, lead_owner_id, start_date, target_date, agency_clients(name), brands(name)')
            .order('target_date', { ascending: true, nullsFirst: false })
            .order('name')
        ),
        dataOrThrow(
          client.from('work_items')
            .select('id, organization_id, engagement_id, status, automation_flagged_at, deleted_at')
            .is('deleted_at', null)
        ),
        dataOrThrow(
          client.from('engagement_stage_instances')
            .select('id, organization_id, engagement_id, status')
        ),
      ])
      return { engagements, workItems, stages }
    },

    async getEngagement(engagementId) {
      required(engagementId, 'engagementId')
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
        dataOrThrow(client.from('engagements').select('*, agency_clients(*), brands(*)').eq('id', engagementId).single()),
        dataOrThrow(client.from('engagement_services').select('*, service_catalog(*)').eq('engagement_id', engagementId).order('activated_at')),
        dataOrThrow(client.from('engagement_stage_instances').select('*').eq('engagement_id', engagementId).order('position')),
        dataOrThrow(client.from('engagement_stage_dependencies').select('*').eq('engagement_id', engagementId)),
        dataOrThrow(client.from('engagement_prerequisites').select('*').eq('engagement_id', engagementId).order('recorded_at')),
        dataOrThrow(client.from('engagement_assets').select('*').eq('engagement_id', engagementId).order('created_at')),
        dataOrThrow(client.from('engagement_events').select('*').eq('engagement_id', engagementId).order('occurred_at')),
        dataOrThrow(client.from('integration_connection_engagements').select('*, integration_connections(provider, display_name, status)').eq('engagement_id', engagementId)),
        dataOrThrow(client.from('artifacts').select('*').eq('engagement_id', engagementId).in('artifact_type', DEVELOPMENT_ARTIFACT_TYPES).order('created_at')),
        dataOrThrow(client.from('artifact_versions').select('*, artifacts!inner(engagement_id, artifact_type)').eq('artifacts.engagement_id', engagementId).in('artifacts.artifact_type', DEVELOPMENT_ARTIFACT_TYPES).order('version_number')),
        dataOrThrow(client.from('artifact_approvals').select('*').eq('engagement_id', engagementId).order('approved_at')),
        dataOrThrow(client.from('artifacts').select('*').eq('engagement_id', engagementId).order('created_at')),
        dataOrThrow(client.from('artifact_versions').select('*, artifacts!inner(engagement_id)').eq('artifacts.engagement_id', engagementId).order('version_number')),
        dataOrThrow(client.from('content_requests').select('id, organization_id, engagement_id, brand_id, mode, status, output_path, format, brief, created_at, queue_entry_id, linked_event_id').eq('engagement_id', engagementId).order('created_at', { ascending: false })),
        dataOrThrow(client.from('work_items').select('id, title, status, priority, department_id, linked_engagement_stage_instance_id, assignee_id, created_at').eq('engagement_id', engagementId).is('deleted_at', null).order('position')),
        dataOrThrow(client.from('design_workshop_sessions').select('id').eq('engagement_id', engagementId).order('created_at', { ascending: false })),
      ])

      const queueEntryIds = contentRequests.map((request) => request.queue_entry_id).filter(Boolean)
      const queueEntries = queueEntryIds.length
        ? await dataOrThrow(client.from('content_queue_entries')
          .select('id, organization_id, brand_id, planned_date, format, status, brief_template, linked_event_id, fulfilled_by_request_id')
          .in('id', queueEntryIds)
          .order('planned_date', { ascending: false })
          .order('created_at', { ascending: false }))
        : []

      const designDirectionIds = designSessions.length ? designSessions.map((session) => session.id) : []
      const designDirectionRows = designDirectionIds.length
        ? await dataOrThrow(client.from('design_directions').select('id').in('session_id', designDirectionIds))
        : []
      const directionIds = designDirectionRows.map((direction) => direction.id)
      const designDirectionVersions = directionIds.length
        ? await dataOrThrow(client.from('design_direction_versions').select('id').in('direction_id', directionIds))
        : []
      const designDirectionVersionIds = designDirectionVersions.map((version) => version.id)
      const pageDesigns = designDirectionVersionIds.length
        ? await dataOrThrow(client.from('website_page_designs')
          .select('id, organization_id, design_direction_version_id, slug, status, created_at, updated_at')
          .in('design_direction_version_id', designDirectionVersionIds)
          .order('created_at', { ascending: false }))
        : []
      const designExportJobs = pageDesigns.length
        ? await dataOrThrow(client.from('wordpress_export_jobs')
          .select('id, website_page_design_id, status, provider, requested_at, completed_at, failure_reason')
          .in('website_page_design_id', pageDesigns.map((item) => item.id))
          .order('requested_at', { ascending: false }))
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
