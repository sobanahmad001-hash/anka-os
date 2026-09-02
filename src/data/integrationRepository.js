import { supabase } from '../lib/supabase.js'

async function invoke(body) {
  const { data, error } = await supabase.functions.invoke('integration-gateway', { body })
  if (error) throw new Error(error.message || 'Integration service failed')
  if (data?.error) throw new Error(data.error)
  return data
}

async function invokeGoogle(body) {
  const { data, error } = await supabase.functions.invoke('google-oauth', { body })
  if (error) throw new Error(error.message || 'Google authorization service failed')
  if (data?.error) throw new Error(data.error)
  return data
}

async function invokeMeta(body) {
  const { data, error } = await supabase.functions.invoke('meta-oauth', { body })
  if (error) throw new Error(error.message || 'Meta authorization service failed')
  if (data?.error) throw new Error(data.error)
  return data
}

export const integrations = Object.freeze({
  list: (departmentId = null) => invoke({ action: 'list', department_id: departmentId }),
  save: (connection) => invoke({ action: 'save', ...connection }),
  test: (connectionId) => invoke({ action: 'test', connection_id: connectionId }),
  disable: (connectionId) => invoke({ action: 'disable', connection_id: connectionId }),
  startGoogleOAuth: (connection) => invokeGoogle({ action: 'start', ...connection }),
  configureGoogleReporting: (connectionId, publicConfig) => invokeGoogle({
    action: 'configure_reporting', connection_id: connectionId, public_config: publicConfig,
  }),
  disconnectGoogleOAuth: (connectionId) => invokeGoogle({ action: 'disconnect', connection_id: connectionId }),
  startMetaOAuth: (connection) => invokeMeta({ action: 'start', ...connection }),
  syncMetaOrganicMetrics: (connectionId, snapshotDate) => invokeMeta({ action: 'sync', connection_id: connectionId, snapshot_date: snapshotDate }),
  disconnectMetaOAuth: (connectionId) => invokeMeta({ action: 'disconnect', connection_id: connectionId }),
})
