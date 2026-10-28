const MESSAGES = {
  authentication_required: 'Sign in to Anka again before testing this connection.',
  access_denied: 'You do not have permission to test this connection in the selected organization.',
  secret_missing: 'The named Edge Function secret is not configured. Ask the backend operator to check the secret name without sharing its value.',
  upstream_authentication: 'The connected service rejected authentication (HTTP 401). Verify the dedicated username and saved Application Password privately; do not share credentials or repeat an unchanged test.',
  upstream_permission: 'The connected service denied this account permission (HTTP 403). Review the required account capability; do not broaden its role automatically.',
  wordpress_disabled: 'WordPress reports Application Passwords are disabled for this site. The hosting operator must inspect the restriction; do not rotate the password.',
  wordpress_user_disabled: 'WordPress reports Application Passwords are disabled for this account. Inspect the account restriction without broadening its role.',
  wordpress_not_authenticated: 'WordPress did not authenticate this REST request. Inspect request-specific authentication availability and header delivery.',
  wordpress_account_unknown: 'WordPress did not recognize the account on this target site. Inspect the staging account record without sharing credentials.',
  wordpress_credential_rejected: 'WordPress rejected the Application Password for this account. Investigate privately; do not share or rotate credentials automatically.',
  test_unconfirmed: 'The connection test could not be confirmed. Check its recorded status before trying again.',
}
function failure(code) {
  const error = new Error(MESSAGES[code] || MESSAGES.test_unconfirmed)
  error.code = Object.hasOwn(MESSAGES, code) ? code : 'test_unconfirmed'
  return error
}
// Read only fixed gateway codes; never expose server/provider error bodies or credentials.
export async function testConnectionMetadata(invoke, body) {
  let result
  try { result = await invoke(body) } catch { throw failure('test_unconfirmed') }
  const { data, error } = result || {}
  if (error || data?.error) {
    let payload = data
    const status = error?.context?.status
    if (typeof error?.context?.clone === 'function') {
      try { payload = await error.context.clone().json() } catch { payload = null }
    }
    if (status === 401) throw failure('authentication_required')
    if (status === 403) throw failure('access_denied')
    if (status === 409 && payload?.error === 'The named Edge Function secret is not configured') throw failure('secret_missing')
    const wordpressCodes = { application_passwords_disabled: 'wordpress_disabled', application_passwords_disabled_for_user: 'wordpress_user_disabled', rest_not_logged_in: 'wordpress_not_authenticated', invalid_username: 'wordpress_account_unknown', invalid_email: 'wordpress_account_unknown', incorrect_password: 'wordpress_credential_rejected' }
    if ((status === 502 || status == null) && ['HTTP_401', 'HTTP_403'].includes(payload?.code) && Object.hasOwn(wordpressCodes, payload?.wordpress_code)) throw failure(wordpressCodes[payload.wordpress_code])
    if ((status === 502 || status == null) && payload?.code === 'HTTP_401') throw failure('upstream_authentication')
    if ((status === 502 || status == null) && payload?.code === 'HTTP_403') throw failure('upstream_permission')
    throw failure('test_unconfirmed')
  }
  if (data?.success !== true || !Number.isFinite(data.latency_ms) || data.latency_ms < 0) throw failure('test_unconfirmed')
  return data
}
