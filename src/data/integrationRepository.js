import { supabase } from '../lib/supabase.js'

async function invoke(body) {
  const { data, error } = await supabase.functions.invoke('integration-gateway', { body })
  if (error) throw new Error(error.message || 'Integration service failed')
  if (data?.error) throw new Error(data.error)
  return data
}

export const integrations = Object.freeze({
  list: () => invoke({ action: 'list' }),
  save: (connection) => invoke({ action: 'save', ...connection }),
  test: (connectionId) => invoke({ action: 'test', connection_id: connectionId }),
  disable: (connectionId) => invoke({ action: 'disable', connection_id: connectionId }),
})
