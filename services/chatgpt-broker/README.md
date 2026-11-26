# ChatGPT credential broker — hosting review required

Local candidate only. Do not activate the direct Supabase MCP connection. The direct OAuth credential passed database isolation tests but could update the user's managed Auth account. This broker uses FastMCP 4.2.6 OAuthProxy to issue separate client tokens and encrypt upstream access/refresh credentials in a persistent file store. The client token cannot authenticate to Supabase Auth or its Data API. The broker calls only `hybrid_mcp_context` and `save_hybrid_work_draft`; both check current selected-project grants and Auth sessions. It never uses a service-role credential.

## Proposed hosting unit for owner review

One non-root Python container, one replica, persistent encrypted `/data` volume, and HTTPS ingress on a new dedicated broker URL. No autoscaling or ephemeral-only storage: the framework's refresh coordination is process-local. Keep signing and encryption secrets independent and stable across restarts. An encrypted volume backup and corresponding secret recovery are required; loss of either forces reconnection. Do not log Authorization headers, token requests/responses, callback query strings, or consent bodies. Disable request-body and query-string capture at the ingress.

Hosting provider, region, hostname, volume, retention, resource limits and recurring cost remain unselected. Owner explicitly requires hosting review before activation. No hosted service or paid resource has been created. Review the concrete existing-account deployment option before provisioning.

## Configuration

`BROKER_PUBLIC_URL`: exact HTTPS broker origin, with `/mcp` as its resource endpoint. `SUPABASE_URL`: existing Anka project origin. `SUPABASE_PUBLISHABLE_KEY`: public project API key, never a service key. `BROKER_UPSTREAM_AUDIENCE`: exact resource audience configured by the reviewed Supabase token hook. `BROKER_UPSTREAM_CLIENT_ID`: dedicated Supabase OAuth public client, with only the broker's exact `/auth/callback` URL registered; both OAuth legs use PKCE S256. Disable hosted Supabase dynamic registration: ChatGPT registers with the broker, not Supabase.

`BROKER_SIGNING_KEY`: independent random secret of at least 48 characters. `BROKER_ENCRYPTION_KEY`: Fernet key generated with cryptographic randomness. `BROKER_STORAGE_DIRECTORY`: absolute persistent directory. `BROKER_CLIENT_REDIRECT_URIS`: JSON array containing only the exact callback URL shown by the owner's ChatGPT connection setup; no wildcards. `BROKER_LOCAL_TEST=1` permits loopback HTTP exclusively for disposable tests and must be absent in production. CIMD is disabled for this bounded DCR candidate.

One selected project grant per Anka user and upstream broker client. Selecting another project changes that connection's current access; it does not retain multiple simultaneous project grants. Disconnect revokes database access immediately, including cached broker tokens; it retains audit and draft history. Server-held tokens expire normally and remain encrypted until expiration or purge. No background provider execution is added.

## Validation

`python -m unittest -v` verifies separate token handling, tampering, upstream-token rejection, encryption at rest, restart recovery, wrong encryption/signing keys and invalid configuration. CI installs the exact tested dependency versions from `requirements.txt`.

The disposable HTTP acceptance harness requires an explicitly prepared synthetic localhost fixture; never pass production credentials. It exercises real provider consent, both PKCE legs, code replay, callback/CSRF restrictions, Auth account-update and Data API denial, approved version context, cross-project denial, supplied draft save/reopen/retry, refresh rotation and cached-token grant revocation. Framework tokens in unit fixtures are not evidence of native ChatGPT acceptance.

Release gates still include hosting approval, exact hosted migration/hook/client setup, image/deployment verification, signed-in native ChatGPT connection and original pilot-card acceptance. Preserve all existing tracking manifests, schedules and project records. Claude remains deferred.
