export function selectDepartmentChatModelConfiguration(capabilities, currentConfigurationId = '') {
  const available = Array.isArray(capabilities?.approved_models) ? capabilities.approved_models : []
  if (available.some(model => model.configuration_id === currentConfigurationId)) return currentConfigurationId
  const defaultId = capabilities?.default_model_configuration_id
  if (available.some(model => model.configuration_id === defaultId)) return defaultId
  return available[0]?.configuration_id || ''
}
