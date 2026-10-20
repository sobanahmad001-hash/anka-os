export async function invokeDesignFunction(client, functionName, organizationId, action, input = {}, { signal, fallbackMessage = 'Design function failed' } = {}) {
  if (signal?.aborted) throw signal.reason || new DOMException('The request was aborted.', 'AbortError')
  const { data, error } = await client.functions.invoke(functionName, {
    body: { action, ...input, organization_id: organizationId },
    signal,
  })
  let details=data
  if(error && ['confirm_video_brief','quote_media_request'].includes(action) && error.context?.clone) {try {details=await error.context.clone().json()} catch { /* Unknown outcomes remain blocked. */ }}
  const safeQuoteMessages={MEDIA_RATE_UNAVAILABLE:'Admin pricing setup required: a current reviewed price is unavailable for these exact settings.',MEDIA_QUOTE_UNAVAILABLE:'The exact price could not be verified. Nothing was generated. Try Generate again.'}
  if(action==='quote_media_request' && error)details=safeQuoteMessages[details?.code]?{code:details.code,error:safeQuoteMessages[details.code]}:null
  const knownRollback=action==='confirm_video_brief' && details?.rollback_verified===true && ['22023','42501','40001','55000'].includes(details.code)
  if (error || data?.error) throw Object.assign(new Error(details?.error || error?.message || fallbackMessage), {cause:error,status:error?.status || error?.statusCode || error?.context?.status,code:details?.code,knownRollback})
  return data?.data
}
