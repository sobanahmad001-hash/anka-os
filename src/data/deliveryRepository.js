const requireOrganizationId = (organizationId) => {
  if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('organizationId is required')
  return organizationId
}

const withRequestSignal = (query, signal) => signal && typeof query?.abortSignal === 'function' ? query.abortSignal(signal) : query

const assertOrganizationRecords = (organizationId, ...collections) => {
  requireOrganizationId(organizationId)
  for (const collection of collections) {
    const records = Array.isArray(collection) ? collection : collection ? [collection] : []
    if (records.some(record => record?.organization_id && record.organization_id !== organizationId)) {
      throw Object.assign(new Error('The requested record is unavailable in the active organization.'), {
        status: 403,
        membershipMismatch: true,
      })
    }
  }
}

export const TASK_STATUSES = Object.freeze([
  'backlog',
  'ready',
  'in_progress',
  'blocked',
  'ready_for_review',
  'changes_required',
  'done',
  'cancelled',
])

export const DELIVERABLE_VERSION_STATUSES = Object.freeze([
  'in_production',
  'ready_for_internal_review',
  'changes_required',
  'ready_for_client_review',
  'client_reviewing',
  'revision_requested',
  'client_approved',
  'delivered_published',
  'superseded',
])

export const WORKSTREAM_DEPARTMENTS = Object.freeze([
  Object.freeze({ id: 'content', name: 'Content' }),
  Object.freeze({ id: 'design', name: 'Design' }),
  Object.freeze({ id: 'development', name: 'Development' }),
  Object.freeze({ id: 'marketing', name: 'Marketing' }),
])

export const TASK_TRANSITIONS = Object.freeze({
  backlog: Object.freeze(['ready', 'cancelled']),
  ready: Object.freeze(['backlog', 'in_progress', 'blocked', 'cancelled']),
  in_progress: Object.freeze(['backlog', 'blocked', 'ready_for_review', 'cancelled']),
  blocked: Object.freeze(['ready', 'in_progress', 'cancelled']),
  ready_for_review: Object.freeze(['in_progress', 'changes_required', 'done']),
  changes_required: Object.freeze(['in_progress', 'ready_for_review', 'cancelled']),
  done: Object.freeze(['in_progress']),
  cancelled: Object.freeze(['backlog']),
})

function assertIdentifier(value, label) {
  if (!value || typeof value !== 'string') {
    throw new TypeError(`${label} is required`)
  }
}

function assertTaskStatus(status) {
  if (!TASK_STATUSES.includes(status)) {
    throw new TypeError(`Unsupported task status: ${status}`)
  }
}

function assertDepartment(departmentId) {
  if (!WORKSTREAM_DEPARTMENTS.some((department) => department.id === departmentId)) {
    throw new TypeError(`Unsupported department: ${departmentId}`)
  }
}

async function dataOrThrow(query) {
  const { data, error, status } = await query

  if (error) {
    const failure = new Error(error.message || 'Supabase delivery query failed')
    failure.cause = error
    failure.status = status || error.status || error.statusCode
    throw failure
  }

  return data
}

/**
 * The only supported Supabase boundary for the canonical delivery core.
 * Screens should consume this repository instead of choosing table names.
 */
export function createDeliveryRepository(client) {
  if (!client?.from) {
    throw new TypeError('A Supabase-compatible client is required')
  }

  return Object.freeze({
    async listClients() {
      return dataOrThrow(
        client
          .from('clients')
          .select('id, name, company, email, industry, status, owner_id, created_at, updated_at')
          .order('name')
      )
    },

    async getClientWorkspace(clientId) {
      assertIdentifier(clientId, 'clientId')
      const [clientRecord, projects, contacts, access] = await Promise.all([
        dataOrThrow(client.from('clients').select('*').eq('id', clientId).single()),
        dataOrThrow(client.from('projects').select('*').eq('client_id', clientId).is('archived_at', null).order('updated_at', { ascending: false })),
        dataOrThrow(client.from('client_contacts').select('*').eq('client_id', clientId).order('created_at')),
        dataOrThrow(client.from('project_client_access').select('*').order('created_at')),
      ])
      const contactIds = new Set((contacts || []).map(contact => contact.id))
      return {
        client: clientRecord,
        projects: projects || [],
        contacts: contacts || [],
        access: (access || []).filter(item => contactIds.has(item.client_contact_id)),
      }
    },

    async inviteClientContact(input) {
      assertIdentifier(input?.clientId, 'clientId')
      assertIdentifier(input?.fullName, 'full name')
      assertIdentifier(input?.email, 'email')
      if (!client.functions?.invoke) throw new TypeError('Supabase Functions are required for client invitations')
      const { data, error } = await client.functions.invoke('invite-client-contact', { body: input })
      if (error) throw new Error(error.message || 'Client invitation failed')
      if (data?.error) throw new Error(data.error)
      return data
    },

    async listProjects() {
      return dataOrThrow(
        client
          .from('projects')
          .select('id, organization_id, client_id, name, description, engagement_type, status, priority, health, owner_id, start_date, due_date, portal_visible, created_at, updated_at')
          .is('archived_at', null)
          .order('updated_at', { ascending: false })
      )
    },

    async getAgencyCommandCenter() {
      const [projects, clients, tasks, requests, milestones, reviewVersions, activities, memberships, profiles] = await Promise.all([
        dataOrThrow(client.from('projects').select('*').is('archived_at', null).order('updated_at', { ascending: false })),
        dataOrThrow(client.from('clients').select('id, name, company, status').order('name')),
        dataOrThrow(client.from('tasks').select('*, projects(id, name)').is('archived_at', null).not('status', 'in', '(done,cancelled)').order('due_date')),
        dataOrThrow(client.from('requests').select('*, projects(id, name)').is('archived_at', null).not('status', 'in', '(completed,declined,withdrawn)').order('required_by')),
        dataOrThrow(client.from('milestones').select('*, projects(id, name)').is('archived_at', null).not('status', 'in', '(completed,cancelled)').order('target_date')),
        dataOrThrow(client.from('deliverable_versions').select('*, deliverables(id, title), projects(id, name)').in('review_status', ['ready_for_internal_review', 'ready_for_client_review']).order('created_at')),
        dataOrThrow(client.from('activity_events').select('*').order('occurred_at', { ascending: false }).limit(60)),
        dataOrThrow(client.from('organization_memberships').select('*').eq('member_kind', 'team').eq('status', 'active')),
        dataOrThrow(client.from('profiles').select('id, full_name, email, department, role')),
      ])

      const profileById = new Map((profiles || []).map(profile => [profile.id, profile]))
      return {
        projects: projects || [],
        clients: clients || [],
        tasks: tasks || [],
        requests: requests || [],
        milestones: milestones || [],
        reviewVersions: reviewVersions || [],
        activities: activities || [],
        members: (memberships || []).map(membership => ({
          ...membership,
          profile: profileById.get(membership.user_id) || null,
        })),
      }
    },

    async createClient(input, actorId) {
      assertIdentifier(input?.name, 'client name')
      assertIdentifier(actorId, 'actorId')

      return dataOrThrow(
        client
          .from('clients')
          .insert({
            name: input.name.trim(),
            company: input.company?.trim() || input.name.trim(),
            email: input.email?.trim() || null,
            industry: input.industry?.trim() || '',
            status: 'active',
            owner_id: actorId,
          })
          .select()
          .single()
      )
    },

    async getProjectWorkspace(projectId) {
      assertIdentifier(projectId, 'projectId')

      const [project, workstreams, milestones, tasks, dependencies, research, deliverables, requests, livingRecord, snapshots, activities, portalItems] = await Promise.all([
        dataOrThrow(client.from('projects').select('*').eq('id', projectId).single()),
        dataOrThrow(client.from('workstreams').select('*').eq('project_id', projectId).order('created_at')),
        dataOrThrow(client.from('milestones').select('*').eq('project_id', projectId).is('archived_at', null).order('position')),
        dataOrThrow(client.from('tasks').select('*').eq('project_id', projectId).is('archived_at', null).order('created_at')),
        dataOrThrow(client.from('task_dependencies').select('*').eq('project_id', projectId).order('created_at')),
        dataOrThrow(client.from('research_records').select('*').eq('project_id', projectId).is('archived_at', null).order('updated_at', { ascending: false })),
        dataOrThrow(client.from('deliverables').select('*, deliverable_versions(*)').eq('project_id', projectId).is('archived_at', null).order('updated_at', { ascending: false })),
        dataOrThrow(client.from('requests').select('*').eq('project_id', projectId).is('archived_at', null).order('updated_at', { ascending: false })),
        dataOrThrow(client.from('living_project_documents').select('*').eq('project_id', projectId).single()),
        dataOrThrow(client.from('living_project_document_snapshots').select('*').eq('project_id', projectId).order('generated_at', { ascending: false })),
        dataOrThrow(client.from('activity_events').select('*').eq('project_id', projectId).order('occurred_at', { ascending: false }).limit(100)),
        dataOrThrow(client.from('client_portal_items').select('*').eq('project_id', projectId).is('withdrawn_at', null).order('released_at', { ascending: false })),
      ])

      return {
        project,
        workstreams,
        milestones,
        tasks,
        dependencies,
        research,
        deliverables,
        requests,
        livingRecord,
        snapshots: snapshots || [],
        activities: activities || [],
        portalItems: portalItems || [],
      }
    },

    async createLivingRecordSnapshot(input, actorId) {
      assertIdentifier(input?.projectId, 'projectId')
      assertIdentifier(input?.livingRecordId, 'livingRecordId')
      assertIdentifier(actorId, 'actorId')
      if (!['internal', 'client'].includes(input.projectionKind)) {
        throw new TypeError('Projection kind must be internal or client')
      }
      if (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 1) {
        throw new TypeError('A positive source version is required')
      }

      const existing = await dataOrThrow(
        client.from('living_project_document_snapshots')
          .select('*')
          .eq('living_project_document_id', input.livingRecordId)
          .eq('projection_kind', input.projectionKind)
          .eq('source_version', input.sourceVersion)
          .limit(1)
      )
      if (existing?.[0]) return existing[0]

      const projectionColumn = input.projectionKind === 'client'
        ? 'client_projection'
        : 'internal_projection'
      await dataOrThrow(
        client.from('living_project_documents').update({
          [projectionColumn]: input.snapshot,
          generated_at: new Date().toISOString(),
        }).eq('id', input.livingRecordId)
      )

      return dataOrThrow(
        client.from('living_project_document_snapshots').insert({
          organization_id: input.organizationId,
          living_project_document_id: input.livingRecordId,
          project_id: input.projectId,
          projection_kind: input.projectionKind,
          source_version: input.sourceVersion,
          snapshot: input.snapshot,
          reason: input.reason?.trim() || 'Manual reporting checkpoint',
          generated_by: actorId,
        }).select().single()
      )
    },

    async getDepartmentWorkspace(departmentId, activeOrganizationId, { signal } = {}) {
      assertDepartment(departmentId)
      const organizationId = requireOrganizationId(activeOrganizationId)
      const load = (query) => dataOrThrow(withRequestSignal(query, signal))

      const workstreams = await load(
        client
          .from('workstreams')
          .select('*, projects(id, organization_id, name, status, priority, health, due_date, engagement_type)')
          .eq('organization_id', organizationId)
          .eq('department_id', departmentId)
          .in('status', ['planned', 'active', 'on_hold'])
          .order('updated_at', { ascending: false })
      ) || []

      const workstreamIds = workstreams.map((workstream) => workstream.id)
      const projectIds = [...new Set(workstreams.map((workstream) => workstream.project_id))]

      if (workstreamIds.length === 0) {
        return {
          departmentId,
          workstreams: [],
          relatedWorkstreams: [],
          engagements: [],
          tasks: [],
          workItems: [],
          services: [],
          stages: [],
          research: [],
          milestones: [],
          deliverables: [],
          requests: [],
        }
      }

      const engagements = await load(
        client
          .from('engagements')
          .select('id, organization_id, project_id, name, status')
          .eq('organization_id', organizationId)
          .in('project_id', projectIds)
      ) || []
      const engagementIds = engagements.map((engagement) => engagement.id)

      const [relatedWorkstreams, tasks, workItems, services, stages, research, milestones, deliverables, projectRequests] = await Promise.all([
        load(
          client
            .from('workstreams')
            .select('id, organization_id, project_id, department_id, name, status')
            .eq('organization_id', organizationId)
            .in('project_id', projectIds)
            .in('status', ['planned', 'active', 'on_hold'])
            .order('created_at')
        ),
        load(
          client
            .from('tasks')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('department_id', departmentId)
            .is('archived_at', null)
            .order('due_date')
        ),
        engagementIds.length ? load(
          client
            .from('work_items')
            .select('*, projects(id, name), engagements(id, name)')
            .eq('organization_id', organizationId)
            .eq('department_id', departmentId)
            .in('engagement_id', engagementIds)
            .is('deleted_at', null)
            .order('due_date')
        ) : Promise.resolve([]),
        engagementIds.length ? load(
          client
            .from('engagement_services')
            .select('id, organization_id, engagement_id, owner_id, target_date, status, service_catalog!inner(id, department_id, name, slug)')
            .eq('organization_id', organizationId)
            .in('engagement_id', engagementIds)
            .eq('service_catalog.department_id', departmentId)
            .in('status', ['planned', 'active', 'on_hold'])
            .order('target_date')
        ) : Promise.resolve([]),
        engagementIds.length ? load(
          client
            .from('engagement_stage_instances')
            .select('id, organization_id, engagement_id, name, accountable_department_id, stage_kind, position, status')
            .eq('organization_id', organizationId)
            .eq('accountable_department_id', departmentId)
            .in('engagement_id', engagementIds)
            .order('position')
        ) : Promise.resolve([]),
        load(
          client
            .from('research_records')
            .select('*')
            .eq('organization_id', organizationId)
            .in('project_id', projectIds)
            .is('archived_at', null)
            .order('updated_at', { ascending: false })
        ),
        load(
          client
            .from('milestones')
            .select('*')
            .eq('organization_id', organizationId)
            .in('project_id', projectIds)
            .is('archived_at', null)
            .order('target_date')
        ),
        load(
          client
            .from('deliverables')
            .select('*, deliverable_versions(id, version_number, review_status, created_at)')
            .eq('organization_id', organizationId)
            .in('workstream_id', workstreamIds)
            .is('archived_at', null)
            .order('due_date')
        ),
        load(
          client
            .from('requests')
            .select('*')
            .eq('organization_id', organizationId)
            .in('project_id', projectIds)
            .is('archived_at', null)
            .order('required_by')
        ),
      ])

      const relevantResearch = (research || []).filter((record) => (
        record.workstream_id === null || workstreamIds.includes(record.workstream_id)
      ))
      const relevantRequests = (projectRequests || []).filter((request) => (
        workstreamIds.includes(request.requesting_workstream_id)
        || workstreamIds.includes(request.receiving_workstream_id)
      ))
      assertOrganizationRecords(organizationId, workstreams, engagements, relatedWorkstreams, tasks, workItems, services, stages, research, milestones, deliverables, projectRequests)

      return {
        departmentId,
        workstreams,
        relatedWorkstreams: relatedWorkstreams || [],
        engagements,
        tasks: tasks || [],
        workItems: workItems || [],
        services: services || [],
        stages: stages || [],
        research: relevantResearch,
        milestones: milestones || [],
        deliverables: deliverables || [],
        requests: relevantRequests,
      }
    },

    async getMyWork(userId, activeOrganizationId, { signal } = {}) {
      assertIdentifier(userId, 'userId')
      const organizationId = requireOrganizationId(activeOrganizationId)
      const load = (query) => dataOrThrow(withRequestSignal(query, signal))

      const [tasks, workItems, requests, deliverables, reviewVersions, releaseVersions] = await Promise.all([
        load(
          client.from('tasks')
            .select('*, projects(id, name), workstreams(id, name, department_id)')
            .eq('organization_id', organizationId)
            .eq('assigned_to', userId)
            .is('archived_at', null)
            .order('due_date')
        ),
        load(
          client.from('work_items')
            .select('*, projects(id, name), engagements(id, name)')
            .eq('organization_id', organizationId)
            .eq('assignee_id', userId)
            .is('deleted_at', null)
            .order('due_date')
        ),
        load(
          client.from('requests')
            .select('*, projects(id, name)')
            .eq('organization_id', organizationId)
            .or(`owner_id.eq.${userId},requested_by.eq.${userId}`)
            .is('archived_at', null)
            .order('required_by')
        ),
        load(
          client.from('deliverables')
            .select('*, projects(id, name), workstreams(id, name, department_id), deliverable_versions(id, version_number, review_status, created_at)')
            .eq('organization_id', organizationId)
            .eq('owner_id', userId)
            .is('archived_at', null)
            .order('due_date')
        ),
        load(
          client.from('deliverable_versions')
            .select('*, deliverables(id, title, deliverable_type, owner_id), projects(id, name)')
            .eq('organization_id', organizationId)
            .eq('review_status', 'ready_for_internal_review')
            .order('created_at')
        ),
        load(
          client.from('deliverable_versions')
            .select('*, deliverables(id, title, deliverable_type, owner_id), projects(id, name, client_id)')
            .eq('organization_id', organizationId)
            .eq('review_status', 'ready_for_client_review')
            .order('internal_reviewed_at')
        ),
      ])
      assertOrganizationRecords(organizationId, tasks, workItems, requests, deliverables, reviewVersions, releaseVersions)

      return {
        tasks: tasks || [],
        workItems: workItems || [],
        requests: requests || [],
        deliverables: deliverables || [],
        reviewVersions: reviewVersions || [],
        releaseVersions: releaseVersions || [],
      }
    },

    async createProject(input, actorId) {
      assertIdentifier(input?.name, 'project name')
      assertIdentifier(actorId, 'actorId')

      return dataOrThrow(
        client
          .from('projects')
          .insert({
            name: input.name.trim(),
            description: input.description?.trim() || '',
            client_id: input.clientId || null,
            department_id: input.departmentId || null,
            engagement_type: input.engagementType || 'project',
            status: input.status || 'planning',
            priority: input.priority || 'medium',
            owner_id: input.ownerId || actorId,
            start_date: input.startDate || null,
            due_date: input.dueDate || null,
            scope_statement: input.scopeStatement?.trim() || '',
            exclusions: input.exclusions?.trim() || '',
            portal_visible: false,
          })
          .select()
          .single()
      )
    },

    async createWorkstreams(projectId, departmentIds, actorId) {
      assertIdentifier(projectId, 'projectId')
      assertIdentifier(actorId, 'actorId')

      const allowedDepartments = new Map(
        WORKSTREAM_DEPARTMENTS.map((department) => [department.id, department.name])
      )
      const uniqueDepartments = [...new Set(departmentIds || [])]

      if (uniqueDepartments.length === 0) {
        throw new TypeError('At least one workstream is required')
      }

      for (const departmentId of uniqueDepartments) {
        if (!allowedDepartments.has(departmentId)) {
          throw new TypeError(`Unsupported workstream department: ${departmentId}`)
        }
      }

      return dataOrThrow(
        client
          .from('workstreams')
          .insert(uniqueDepartments.map((departmentId) => ({
            project_id: projectId,
            department_id: departmentId,
            name: allowedDepartments.get(departmentId),
            status: 'active',
            owner_id: actorId,
            client_visible: false,
            started_at: new Date().toISOString(),
          })))
          .select()
      )
    },

    async activateWorkflowTemplate(projectId, workstreams, templateSlug, actorId) {
      assertIdentifier(projectId, 'projectId')
      assertIdentifier(templateSlug, 'templateSlug')
      assertIdentifier(actorId, 'actorId')

      const template = await dataOrThrow(
        client.from('workflow_templates')
          .select('*, workflow_stages(*)')
          .eq('slug', templateSlug).eq('is_active', true)
          .order('version', { ascending: false }).limit(1).single()
      )
      const stages = [...(template.workflow_stages || [])].sort((a, b) => a.position - b.position)
      if (!stages.length) throw new TypeError(`Workflow template has no stages: ${templateSlug}`)

      await dataOrThrow(
        client.from('project_workflow_templates').upsert({
          project_id: projectId,
          workstream_id: null,
          workflow_template_id: template.id,
          activated_by: actorId,
        }, { onConflict: 'project_id,workstream_id,workflow_template_id' })
      )

      const workstreamByDepartment = new Map((workstreams || []).map(item => [item.department_id, item]))
      const tasks = await dataOrThrow(
        client.from('tasks').insert(stages.map((stage, index) => {
          const workstream = stage.department_id ? workstreamByDepartment.get(stage.department_id) : null
          return {
            project_id: projectId,
            workstream_id: workstream?.id || null,
            department_id: stage.department_id || null,
            workflow_stage_id: stage.id,
            title: stage.name,
            description: stage.instructions,
            acceptance_criteria: (stage.exit_criteria || []).map(item => `• ${item}`).join('\n'),
            status: index === 0 ? 'ready' : 'backlog',
            priority: 'medium',
            user_id: actorId,
            created_by: actorId,
            assigned_by: actorId,
            assigned_to: actorId,
            visibility: 'internal_only',
          }
        })).select()
      )

      const taskByStage = new Map((tasks || []).map(task => [task.workflow_stage_id, task]))
      const dependencyRows = stages.slice(1).map((stage, index) => ({
        project_id: projectId,
        task_id: taskByStage.get(stage.id)?.id,
        depends_on_task_id: taskByStage.get(stages[index].id)?.id,
        dependency_type: stages[index].requires_internal_review ? 'approval' : 'finish_to_start',
        note: `Generated by ${template.name} v${template.version}`,
        created_by: actorId,
      })).filter(row => row.task_id && row.depends_on_task_id)
      if (dependencyRows.length) await dataOrThrow(client.from('task_dependencies').insert(dependencyRows))
      return { template, stages, tasks, dependencies: dependencyRows }
    },

    async createTaskDependency(input, actorId) {
      assertIdentifier(input?.projectId, 'projectId')
      assertIdentifier(input?.taskId, 'taskId')
      assertIdentifier(input?.dependsOnTaskId, 'dependsOnTaskId')
      assertIdentifier(actorId, 'actorId')
      if (input.taskId === input.dependsOnTaskId) throw new TypeError('A task cannot depend on itself')

      return dataOrThrow(
        client.from('task_dependencies').insert({
          project_id: input.projectId,
          task_id: input.taskId,
          depends_on_task_id: input.dependsOnTaskId,
          dependency_type: input.dependencyType || 'finish_to_start',
          note: input.note?.trim() || '',
          created_by: actorId,
        }).select().single()
      )
    },

    async createTask(input, actorId) {
      assertIdentifier(input?.projectId, 'projectId')
      assertIdentifier(input?.title, 'task title')
      assertIdentifier(actorId, 'actorId')
      assertTaskStatus(input.status || 'backlog')

      return dataOrThrow(
        client
          .from('tasks')
          .insert({
            project_id: input.projectId,
            workstream_id: input.workstreamId || null,
            department_id: input.departmentId || null,
            workflow_stage_id: input.workflowStageId || null,
            title: input.title.trim(),
            description: input.description?.trim() || '',
            acceptance_criteria: input.acceptanceCriteria?.trim() || '',
            status: input.status || 'backlog',
            priority: input.priority || 'medium',
            due_date: input.dueDate || null,
            user_id: actorId,
            created_by: actorId,
            assigned_by: actorId,
            assigned_to: input.assignedTo || actorId,
            visibility: 'internal_only',
          })
          .select()
          .single()
      )
    },

    async transitionTask(taskId, status, completionEvidence = '') {
      assertIdentifier(taskId, 'taskId')
      assertTaskStatus(status)

      return dataOrThrow(
        client
          .from('tasks')
          .update({ status, completion_evidence: completionEvidence.trim() })
          .eq('id', taskId)
          .select()
          .single()
      )
    },

    async createResearchRecord(input, actorId) {
      assertIdentifier(input?.projectId, 'projectId')
      assertIdentifier(input?.title, 'research title')
      assertIdentifier(actorId, 'actorId')

      return dataOrThrow(
        client
          .from('research_records')
          .insert({
            project_id: input.projectId,
            workstream_id: input.workstreamId || null,
            research_type: input.researchType || 'general',
            title: input.title.trim(),
            question: input.question?.trim() || '',
            findings: input.findings?.trim() || '',
            recommendation: input.recommendation?.trim() || '',
            sources: input.sources || [],
            confidence: input.confidence || 'unrated',
            owner_id: actorId,
            visibility: 'internal_only',
          })
          .select()
          .single()
      )
    },

    async createMilestone(input, actorId) {
      assertIdentifier(input?.projectId, 'projectId')
      assertIdentifier(input?.name, 'milestone name')
      assertIdentifier(actorId, 'actorId')

      return dataOrThrow(
        client
          .from('milestones')
          .insert({
            project_id: input.projectId,
            name: input.name.trim(),
            description: input.description?.trim() || '',
            status: 'planned',
            visibility: 'internal_only',
            owner_id: actorId,
            target_date: input.targetDate || null,
            position: input.position || 0,
          })
          .select()
          .single()
      )
    },

    async createDeliverable(input, actorId) {
      assertIdentifier(input?.projectId, 'projectId')
      assertIdentifier(input?.workstreamId, 'workstreamId')
      assertIdentifier(input?.title, 'deliverable title')
      assertIdentifier(actorId, 'actorId')

      return dataOrThrow(
        client
          .from('deliverables')
          .insert({
            project_id: input.projectId,
            workstream_id: input.workstreamId,
            milestone_id: input.milestoneId || null,
            title: input.title.trim(),
            description: input.description?.trim() || '',
            deliverable_type: input.deliverableType || 'general',
            status: 'in_production',
            visibility: 'internal_only',
            owner_id: input.ownerId || actorId,
            created_by: actorId,
            due_date: input.dueDate || null,
          })
          .select()
          .single()
      )
    },

    async createDeliverableVersion(input, actorId) {
      assertIdentifier(input?.projectId, 'projectId')
      assertIdentifier(input?.deliverableId, 'deliverableId')
      assertIdentifier(input?.title, 'version title')
      assertIdentifier(actorId, 'actorId')

      const existing = await dataOrThrow(
        client.from('deliverable_versions')
          .select('version_number')
          .eq('deliverable_id', input.deliverableId)
          .order('version_number', { ascending: false })
          .limit(1)
      )
      const versionNumber = (existing?.[0]?.version_number || 0) + 1
      let fileId = null

      if (input.file) {
        if (!client.storage?.from) throw new TypeError('Supabase Storage is required for file uploads')
        const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
        const storagePath = `${input.projectId}/${input.deliverableId}/${crypto.randomUUID()}-${safeName}`
        const { error: uploadError } = await client.storage.from('sphere-deliverables').upload(storagePath, input.file, {
          upsert: false,
          contentType: input.file.type || undefined,
        })
        if (uploadError) throw new Error(uploadError.message || 'Deliverable upload failed')

        const file = await dataOrThrow(
          client.from('files').insert({
            project_id: input.projectId,
            storage_bucket: 'sphere-deliverables',
            storage_path: storagePath,
            file_name: input.file.name,
            mime_type: input.file.type || null,
            size_bytes: input.file.size,
            visibility: 'internal_only',
            uploaded_by: actorId,
          }).select().single()
        )
        fileId = file.id
      }

      const version = await dataOrThrow(
        client.from('deliverable_versions').insert({
          project_id: input.projectId,
          deliverable_id: input.deliverableId,
          version_number: versionNumber,
          title: input.title.trim(),
          change_summary: input.changeSummary?.trim() || '',
          file_id: fileId,
          preview_metadata: input.previewUrl ? { preview_url: input.previewUrl.trim() } : {},
          review_status: 'in_production',
          created_by: actorId,
        }).select().single()
      )

      await dataOrThrow(
        client.from('deliverables').update({ current_version_id: version.id, status: 'in_production' })
          .eq('id', input.deliverableId)
      )
      return version
    },

    async transitionDeliverableVersion(versionId, reviewStatus) {
      assertIdentifier(versionId, 'versionId')
      if (!DELIVERABLE_VERSION_STATUSES.includes(reviewStatus)) {
        throw new TypeError(`Unsupported deliverable version status: ${reviewStatus}`)
      }

      return dataOrThrow(
        client.from('deliverable_versions').update({ review_status: reviewStatus })
          .eq('id', versionId).select().single()
      )
    },

    async recordInternalQualityDecision(input, actorId) {
      assertIdentifier(input?.projectId, 'projectId')
      assertIdentifier(input?.deliverableId, 'deliverableId')
      assertIdentifier(input?.deliverableVersionId, 'deliverableVersionId')
      assertIdentifier(actorId, 'actorId')
      if (!['approved', 'changes_required'].includes(input.decision)) {
        throw new TypeError('Internal quality decision must be approved or changes_required')
      }

      const approval = await dataOrThrow(
        client.from('approvals').insert({
          project_id: input.projectId,
          deliverable_id: input.deliverableId,
          deliverable_version_id: input.deliverableVersionId,
          approval_type: 'internal_quality',
          decision: input.decision,
          rationale: input.rationale?.trim() || '',
          checklist_result: input.checklistResult || {},
          decided_by: actorId,
        }).select().single()
      )

      const nextStatus = input.decision === 'approved' ? 'ready_for_client_review' : 'changes_required'
      await dataOrThrow(
        client.from('deliverable_versions').update({ review_status: nextStatus })
          .eq('id', input.deliverableVersionId)
      )
      return approval
    },

    async releaseDeliverableVersion(input, actorId) {
      assertIdentifier(input?.projectId, 'projectId')
      assertIdentifier(input?.deliverableId, 'deliverableId')
      assertIdentifier(input?.deliverableVersionId, 'deliverableVersionId')
      assertIdentifier(actorId, 'actorId')

      const [project, version] = await Promise.all([
        dataOrThrow(client.from('projects').select('*').eq('id', input.projectId).single()),
        dataOrThrow(client.from('deliverable_versions').select('*').eq('id', input.deliverableVersionId).single()),
      ])
      if (!project.client_id) throw new TypeError('Internal projects cannot be released to a client portal')
      if (version.review_status !== 'ready_for_client_review') {
        throw new TypeError('Only internally approved versions can be released')
      }

      await dataOrThrow(
        client.from('client_project_projections').upsert({
          project_id: project.id,
          client_id: project.client_id,
          project_name: project.name,
          engagement_type: project.engagement_type,
          summary: project.description || '',
          health: project.health || 'unknown',
          status: project.status,
          start_date: project.start_date,
          due_date: project.due_date,
          next_action: input.nextAction?.trim() || 'Review the newly released deliverable.',
          withdrawn_at: null,
        }, { onConflict: 'project_id' })
      )
      await dataOrThrow(
        client.from('client_portal_items').upsert({
          project_id: project.id,
          source_type: 'deliverable_version',
          source_id: version.id,
          item_type: 'deliverable',
          title: version.title,
          summary: version.change_summary || '',
          status: 'ready_for_review',
          payload: {
            deliverable_id: input.deliverableId,
            version_number: version.version_number,
            file_id: version.file_id,
            preview_url: version.preview_metadata?.preview_url || null,
          },
          released_by: actorId,
          withdrawn_at: null,
        }, { onConflict: 'project_id,source_type,source_id' })
      )
      await dataOrThrow(
        client.from('deliverables').update({
          client_released_version_id: version.id,
          status: 'client_reviewing',
          visibility: 'client_visible',
        }).eq('id', input.deliverableId)
      )
      return dataOrThrow(
        client.from('deliverable_versions').update({ review_status: 'client_reviewing' })
          .eq('id', version.id).select().single()
      )
    },

    async createInternalRequest(input, actorId) {
      assertIdentifier(input?.projectId, 'projectId')
      assertIdentifier(input?.title, 'request title')
      assertIdentifier(input?.requestedOutput, 'requested output')
      assertIdentifier(actorId, 'actorId')

      return dataOrThrow(
        client
          .from('requests')
          .insert({
            project_id: input.projectId,
            requesting_workstream_id: input.requestingWorkstreamId || null,
            receiving_workstream_id: input.receivingWorkstreamId || null,
            request_type: 'internal_handoff',
            request_origin: 'team',
            title: input.title.trim(),
            requested_output: input.requestedOutput.trim(),
            acceptance_criteria: input.acceptanceCriteria?.trim() || '',
            priority: input.priority || 'medium',
            status: 'submitted',
            visibility: 'internal_only',
            requested_by: actorId,
            owner_id: input.ownerId || null,
            required_by: input.requiredBy || null,
          })
          .select()
          .single()
      )
    },

    async submitClientRevision(input, userId) {
      assertIdentifier(input?.projectId, 'projectId')
      assertIdentifier(input?.deliverableVersionId, 'deliverableVersionId')
      assertIdentifier(input?.title, 'revision title')
      assertIdentifier(userId, 'userId')

      return dataOrThrow(
        client
          .from('requests')
          .insert({
            project_id: input.projectId,
            request_type: 'revision',
            request_origin: 'client',
            title: input.title.trim(),
            requested_output: input.requestedOutput?.trim() || input.title.trim(),
            acceptance_criteria: input.acceptanceCriteria?.trim() || '',
            priority: input.priority || 'medium',
            status: 'submitted',
            visibility: 'client_visible',
            requested_by: userId,
            target_deliverable_version_id: input.deliverableVersionId,
            required_by: input.requiredBy || null,
          })
          .select()
          .single()
      )
    },

    async getClientPortal(projectId) {
      assertIdentifier(projectId, 'projectId')

      const [project, items, requests, comments] = await Promise.all([
        dataOrThrow(client.from('client_project_projections').select('*').eq('project_id', projectId).is('withdrawn_at', null).single()),
        dataOrThrow(client.from('client_portal_items').select('*').eq('project_id', projectId).is('withdrawn_at', null).order('released_at', { ascending: false })),
        dataOrThrow(client.from('requests').select('*').eq('project_id', projectId).in('visibility', ['client_visible', 'client_restricted']).order('created_at', { ascending: false })),
        dataOrThrow(client.from('comments').select('*').eq('project_id', projectId).eq('visibility', 'client_shared').order('created_at')),
      ])

      return { project, items, requests, comments }
    },

    async listClientPortalProjects() {
      return dataOrThrow(
        client.from('client_project_projections').select('*')
          .is('withdrawn_at', null).order('updated_at', { ascending: false })
      )
    },

    async getClientContact(userId) {
      assertIdentifier(userId, 'userId')
      const rows = await dataOrThrow(
        client.from('client_contacts').select('*').eq('auth_user_id', userId).eq('status', 'active').limit(1)
      )
      return rows?.[0] || null
    },

    async createClientComment(input, userId) {
      assertIdentifier(input?.projectId, 'projectId')
      assertIdentifier(input?.entityId, 'entityId')
      assertIdentifier(input?.content, 'comment content')
      assertIdentifier(userId, 'userId')

      return dataOrThrow(
        client.from('comments').insert({
          project_id: input.projectId,
          user_id: userId,
          entity_type: input.entityType || 'project',
          entity_id: input.entityId,
          content: input.content.trim(),
          visibility: 'client_shared',
          client_contact_id: input.clientContactId || null,
          anchor: input.anchor || {},
        }).select().single()
      )
    },

    async getPortalFileUrl(fileId) {
      assertIdentifier(fileId, 'fileId')
      if (!client.functions?.invoke) throw new TypeError('Supabase Functions are required for portal file access')
      const { data, error } = await client.functions.invoke('portal-file-url', { body: { file_id: fileId } })
      if (error) throw new Error(error.message || 'Unable to create secure file link')
      if (!data?.signed_url) throw new Error(data?.error || 'Secure file link was not returned')
      return data.signed_url
    },

    subscribeClientPortal(projectId, callback) {
      assertIdentifier(projectId, 'projectId')
      if (!client.channel || !client.removeChannel) return () => {}
      const channel = client.channel(`client-portal-${projectId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'client_project_projections', filter: `project_id=eq.${projectId}` }, callback)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'client_portal_items', filter: `project_id=eq.${projectId}` }, callback)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'requests', filter: `project_id=eq.${projectId}` }, callback)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `project_id=eq.${projectId}` }, callback)
        .subscribe()
      return () => client.removeChannel(channel)
    },
  })
}
