export function selectDepartmentChatModelConfiguration(capabilities, currentConfigurationId = '') {
  const available = Array.isArray(capabilities?.approved_models) ? capabilities.approved_models : []
  if (available.some(model => model.configuration_id === currentConfigurationId)) return currentConfigurationId
  const defaultId = capabilities?.default_model_configuration_id
  if (available.some(model => model.configuration_id === defaultId)) return defaultId
  return available[0]?.configuration_id || ''
}

export function isCurrentModelAllowlistRequest(request, current, generation, currentGeneration) {
  return Boolean(request?.organizationId)
    && !request.signal?.aborted
    && request.organizationId === current?.organizationId
    && request.revision === current?.revision
    && generation === currentGeneration
}

export async function runCurrentModelAllowlistRequest({
  request, generation, currentScope, currentGeneration, load, onSuccess, onError,
}) {
  const isCurrent = () => isCurrentModelAllowlistRequest(
    request, currentScope(), generation, currentGeneration(),
  )
  try {
    const result = await load(request)
    if (!isCurrent()) return false
    onSuccess(result)
    return true
  } catch (error) {
    if (!isCurrent() || error?.name === 'AbortError' || error?.cause?.name === 'AbortError') {
      return false
    }
    onError(error)
    return false
  }
}
