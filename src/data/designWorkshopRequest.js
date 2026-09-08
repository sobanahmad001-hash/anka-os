export async function invokeDesignFunction(client, functionName, organizationId, action, input = {}, { signal, fallbackMessage = 'Design function failed' } = {}) {
  if (signal?.aborted) throw signal.reason || new DOMException('The request was aborted.', 'AbortError')
  const { data, error } = await client.functions.invoke(functionName, {
    body: { action, ...input, organization_id: organizationId },
    signal,
  })
  if (error) throw Object.assign(new Error(error.message || fallbackMessage), {
    cause: error,
    status: error.status || error.statusCode || error.context?.status,
  })
  if (data?.error) throw new Error(data.error)
  return data?.data
}
