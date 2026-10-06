type Scope = { organizationId: string; projectId: string; engagementId: string; departmentId: string; actorId: string }
type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }
// An environment switch alone never grants project execution. This read is only
// preflight; the native one-use claim independently checks and locks the opt-in.
export async function workshopExecutionEnabled(admin: Client, scope: Scope, env: { get: (name: string) => string | undefined }): Promise<boolean> {
  if (env.get('WORKSHOP_CHAT_PAID_EXECUTION_ENABLED') !== 'true') return false
  try {
    const { data, error } = await admin.rpc('get_workshop_execution_readiness', {
      p_organization_id: scope.organizationId, p_project_id: scope.projectId,
      p_engagement_id: scope.engagementId, p_department_id: scope.departmentId, p_actor_id: scope.actorId,
    })
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return false
    const value = data as Record<string, unknown>
    return value.schema_version === 1 && value.enabled === true
      && value.organization_id === scope.organizationId && value.project_id === scope.projectId
      && value.engagement_id === scope.engagementId && value.department_id === scope.departmentId
  } catch { return false }
}
export async function requireWorkshopExecution(admin: Client, scope: Scope, env: { get: (name: string) => string | undefined }) {
  if (!await workshopExecutionEnabled(admin, scope, env)) {
    throw Object.assign(new Error('Workshop AI execution is not enabled for this project and department'), { status: 503 })
  }
}
