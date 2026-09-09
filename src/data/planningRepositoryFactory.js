function failure(error, fallback) {
  const cause = Object.assign(new Error(error?.message || fallback), { cause: error, code: error?.code })
  if (error?.code === '40001') { cause.status = 409; cause.stale = true }
  else if (error?.code === '42501') cause.status = 403
  else if (error?.code === '22023' || error?.code === '23514') cause.status = 400
  return cause
}
function required(value, label) {
  if (!value || (typeof value === 'string' && !value.trim())) throw new TypeError(`${label} is required`)
}

export function createPlanningRepository(client) {
  async function rpc(name, params, fallback) {
    const { data, error } = await client.rpc(name, params)
    if (error) throw failure(error, fallback)
    return data
  }
  return Object.freeze({
    updateProjectTask(organizationId, record, changes = {}) {
      required(organizationId, 'organizationId'); required(record?.id, 'Project Task')
      return rpc('update_p5_project_task', {
        p_organization_id: organizationId, p_task_id: record.id,
        p_expected_row_version: record.row_version,
        p_status: changes.status ?? record.status,
        p_assigned_to: changes.assignedTo === undefined ? record.assigned_to : changes.assignedTo || null,
        p_due_date: changes.dueDate === undefined ? record.due_date || null : changes.dueDate || null,
      }, 'Project Task update failed')
    },
    updateWorkItem(organizationId, record, changes = {}) {
      required(organizationId, 'organizationId'); required(record?.id, 'Engagement Work Item')
      return rpc('update_p5_work_item', {
        p_organization_id: organizationId, p_work_item_id: record.id,
        p_expected_row_version: record.row_version,
        p_assignee_id: changes.assigneeId === undefined ? record.assignee_id : changes.assigneeId || null,
        p_department_id: changes.departmentId === undefined ? record.department_id : changes.departmentId || null,
        p_start_date: changes.startDate === undefined ? record.start_date || null : changes.startDate || null,
        p_due_date: changes.dueDate === undefined ? record.due_date || null : changes.dueDate || null,
      }, 'Engagement Work Item update failed')
    },
    moveWorkItem(organizationId, record, targetStatus, beforeWorkItemId = null) {
      required(organizationId, 'organizationId'); required(record?.id, 'Engagement Work Item')
      return rpc('move_p5_work_item', {
        p_organization_id: organizationId, p_work_item_id: record.id,
        p_expected_row_version: record.row_version, p_target_status: targetStatus,
        p_before_work_item_id: beforeWorkItemId,
      }, 'Engagement Work Item move failed')
    },
    setTimezone(organizationId, recordKind, recordId, timezone) {
      required(organizationId, 'organizationId'); required(recordId, 'Timezone target')
      return rpc('set_p5_planning_timezone', {
        p_organization_id: organizationId, p_record_kind: recordKind,
        p_record_id: recordId, p_timezone: timezone || null,
      }, 'Planning timezone update failed')
    },
  })
}
