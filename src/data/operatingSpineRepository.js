export const OPERATING_DEPARTMENTS = Object.freeze([
  Object.freeze({ id: 'content', name: 'Content' }),
  Object.freeze({ id: 'design', name: 'Design' }),
  Object.freeze({ id: 'development', name: 'Development' }),
  Object.freeze({ id: 'marketing', name: 'Marketing' }),
])

const DEVELOPMENT_ARTIFACT_TYPES = Object.freeze(['technical_brief', 'launch_checklist'])

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
      const membership = await organizationContext(userId)
      const agencyClient = await dataOrThrow(
        client.from('agency_clients').insert({
          organization_id: membership.organization_id,
          name: input.name.trim(),
          legal_name: input.legalName?.trim() || input.name.trim(),
          primary_email: input.primaryEmail?.trim() || null,
          website_url: input.websiteUrl?.trim() || null,
          industry: input.industry?.trim() || '',
          status: 'active',
          owner_id: userId,
          created_by: userId,
        }).select().single()
      )

      try {
        const brand = await dataOrThrow(
          client.from('brands').insert({
            organization_id: membership.organization_id,
            client_id: agencyClient.id,
            name: input.brandName.trim(),
            description: input.brandDescription?.trim() || '',
            website_url: input.brandWebsiteUrl?.trim() || input.websiteUrl?.trim() || null,
            status: 'active',
            is_default: true,
            created_by: userId,
          }).select().single()
        )
        return { client: agencyClient, brand }
      } catch (error) {
        await client.from('agency_clients').delete().eq('id', agencyClient.id)
        throw error
      }
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

    async getEngagement(engagementId) {
      required(engagementId, 'engagementId')
      const [engagement, services, stages, dependencies, prerequisites, assets, events, connectors, developmentArtifacts, developmentArtifactVersions, workItemArtifacts, workItemArtifactVersions] = await Promise.all([
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
        dataOrThrow(client.from('artifacts').select('*').eq('engagement_id', engagementId).order('created_at')),
        dataOrThrow(client.from('artifact_versions').select('*, artifacts!inner(engagement_id)').eq('artifacts.engagement_id', engagementId).order('version_number')),
      ])
      return {
        engagement, services, stages, dependencies, prerequisites, assets, events, connectors,
        developmentArtifacts, developmentArtifactVersions, workItemArtifacts, workItemArtifactVersions,
      }
    },
  })
}
