import { supabase } from '../lib/supabase.js'
import { createReportsAndRecordsRepository } from './reportsAndRecordsRepository.js'
import { projectEngagementWorkspace } from './projectEngagementWorkspace.js'
import { projectServiceScopeRepository } from './projectServiceScopeRepository.js'
import { projectTaskProposalRepository } from './projectTaskProposalRepository.js'
import { projectMemoryRepository } from './projectMemoryRepository.js'
import { projectPipelineConfigurations } from './projectPipelineConfigurations.js'
import { composeLivingProjectReference } from './livingProjectReference.js'

const reports = createReportsAndRecordsRepository(supabase)
export function createLivingProjectReferenceRepository({ records = reports, workspace = projectEngagementWorkspace, services = projectServiceScopeRepository,
  proposals = projectTaskProposalRepository, memory = projectMemoryRepository, pipeline = projectPipelineConfigurations } = {}) {
  return {
    async load(organizationId, projectId, { signal } = {}) {
      signal?.throwIfAborted()
      const [core, project] = await Promise.all([
        records.getProjectWorkspace(projectId, organizationId, { signal }),
        workspace.get(projectId, organizationId, { signal }),
      ])
      signal?.throwIfAborted()
      const sources = await Promise.allSettled([
        services.snapshot(organizationId, projectId, { signal }), proposals.list(organizationId, projectId, { signal }),
        memory.list(organizationId, projectId, { signal }),
        project.engagement ? pipeline.list(organizationId, project.engagement.id, { signal }) : Promise.resolve(null),
      ])
      signal?.throwIfAborted()
      const names = ['Service scopes', 'Task decisions', 'Confirmed project preferences', 'Pipeline configuration']
      const value = index => sources[index].status === 'fulfilled' ? sources[index].value : null
      return { document: composeLivingProjectReference({ organizationId, projectId, records: core, workspace: project,
        services: value(0), proposals: value(1) || [], memory: value(2), pipeline: value(3),
        unavailable: sources.flatMap((item, index) => item.status === 'rejected' ? [names[index]] : []),
      }), records: core }
    },
    preserve: (input, options) => records.createLivingRecordSnapshot(input, options),
  }
}
export const livingProjectReference = createLivingProjectReferenceRepository()
