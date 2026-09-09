function failure(error, fallback) {
  const payload = error?.error?.code ? error.error : error
  const cause = Object.assign(new Error(payload?.message || error?.message || fallback), payload, { cause: error, code: payload?.code })
  if (payload?.code === 'stale_write') { cause.status = 409; cause.stale = true }
  else if (error?.status === 403 || payload?.code === '42501') cause.status = 403
  else if (payload?.code === '22023' || payload?.code === '23514') cause.status = 400
  return cause
}
function required(value, label) {
  if (!value || (typeof value === 'string' && !value.trim())) throw new TypeError(`${label} is required`)
}

export function createPlanningRepository(client) {
  async function invoke(action, body, fallback) {
    const { data, error } = await client.functions.invoke('work-items', { body: { action, ...body } })
    if (error) {
      let payload = null
      try { payload = await error.context?.json?.() } catch { /* preserve transport error */ }
      throw failure(payload || { message: error.message, status: error.context?.status || error.status }, fallback)
    }
    if (data?.error) throw failure(data, fallback)
    return data?.data
  }
  return Object.freeze({
    updateProjectTask(organizationId, record, changes = {}) {
      required(organizationId, 'organizationId'); required(record?.id, 'Project Task')
      return invoke('update_project_task', {
        organizationId, taskId: record.id, expectedRowVersion: record.row_version,
        status: changes.status ?? record.status,
        assignedTo: changes.assignedTo === undefined ? record.assigned_to : changes.assignedTo || null,
        dueDate: changes.dueDate === undefined ? record.due_date || null : changes.dueDate || null,
        completionEvidence: record.completion_evidence || '',
      }, 'Project Task update failed')
    },
    updateWorkItem(organizationId, record, changes = {}) {
      required(organizationId, 'organizationId'); required(record?.id, 'Engagement Work Item')
      return invoke('save', {
        organizationId, engagementId: record.engagement_id, workItemId: record.id,
        expectedRowVersion: record.row_version, title: record.title, description: record.description,
        workItemType: record.work_item_type, priority: record.priority, status: record.status,
        assigneeId: changes.assigneeId === undefined ? record.assignee_id : changes.assigneeId || null,
        departmentId: changes.departmentId === undefined ? record.department_id : changes.departmentId || null,
        linkedArtifactId: record.linked_artifact_id, linkedArtifactVersionId: record.linked_artifact_version_id,
        linkedEngagementStageInstanceId: record.linked_engagement_stage_instance_id,
        startDate: changes.startDate === undefined ? record.start_date || null : changes.startDate || null,
        dueDate: changes.dueDate === undefined ? record.due_date || null : changes.dueDate || null,
        position: record.position, parentWorkItemId: record.parent_work_item_id, created_via: record.created_via,
      }, 'Engagement Work Item update failed')
    },
    moveWorkItem(organizationId, record, targetStatus, beforeWorkItemId = null) {
      required(organizationId, 'organizationId'); required(record?.id, 'Engagement Work Item')
      return invoke('move', {
        organizationId, workItemId: record.id, expectedRowVersion: record.row_version,
        targetStatus, beforeWorkItemId,
      }, 'Engagement Work Item move failed')
    },
    setTimezone(organizationId, recordKind, recordId, timezone) {
      required(organizationId, 'organizationId'); required(recordId, 'Timezone target')
      return invoke('set_timezone', {
        organizationId, recordKind, recordId, timezone: timezone || null,
      }, 'Planning timezone update failed')
    },
  })
}
