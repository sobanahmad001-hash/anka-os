# ChatGPT project connection

**Release HOLD: hosting review and native acceptance required.** The direct Supabase OAuth credential could update the synthetic account through `PUT /auth/v1/user` despite its dedicated role and audience. The replacement in `services/chatgpt-broker` issues separate credentials and keeps upstream tokens encrypted server-side. Its real localhost OAuth tests now deny Auth account updates and Data API access while preserving scoped context and draft operations. Production OAuth remains disabled; no F2 migration or deployment has been performed. Owner approved building the broker, with hosting review before activation. See the broker README for the configuration and remaining gates.

The connection exposes only `project_get_context` and `content_create_draft`. Users sign in through Anka, explicitly choose one active project, and separately opt into saving supplied drafts. `/oauth/consent` also lists and disconnects their grants. Source bodies and private chats are excluded from context; approval IDs, exact version IDs, checksums and dates remain visible.

OAuth tokens use a separate non-inheriting `hybrid_mcp` role and the MCP resource URL as their audience. A current user/client/project grant and live Auth session are checked by narrow SQL functions on every operation. The draft operation retains canonical Work-card authority, immutable request/version identity, conflict detection and retry behavior. Ordinary Edge endpoints reject OAuth identities. The manifest-pinned website tracking worker is unchanged: scheduler ticks require its machine secret; all manual paths first call user RPCs denied by the OAuth API guard. Existing tracking data, schedules and manifests are preserved.

## Validation and release order

Disposable localhost evidence in workspace `outputs/sphere-f2-oauth-scoped-result.json`: 16 real Auth/OAuth/database checks and five actual MCP HTTP checks. These cover PKCE consent, wrong verifier/code replay, exact approved context, selected-project isolation, direct-table denial, resource audience/role, immutable save/retry/reopen, read-only grant, revocation, bad signatures, refresh and wrong-audience rejection. Browser sign-in return, empty project default, unchecked save default, explicit consent and disconnect were verified with a synthetic account. This is not native ChatGPT production acceptance.

1. Complete CI and review the exact migration and source tree.
2. Install `20261126170853_hybrid_oauth_project_grants.sql` once. It refuses to overwrite an existing API pre-request hook. No grants or project content are seeded in production.
3. Deploy the guarded Edge entrypoints and `hybrid-mcp`, preserving their existing JWT verification and import-map settings. Deploy the frontend consent route.
4. Inspect existing Auth hooks. Configure `public.hybrid_oauth_token_hook` only when none exists, or integrate explicitly if one exists. The hook preserves ordinary sign-in claims.
5. After hosting review, deploy the broker with encrypted persistent storage and independent signing/storage keys. Configure one dedicated Supabase OAuth client with the exact broker callback, set the authorization path to `/oauth/consent`, and keep Supabase dynamic registration disabled. ChatGPT registers with the broker instead.
6. Connect ChatGPT to the reviewed broker HTTPS `/mcp` URL, sign in, and approve only the selected Anka Sphere project. Verify the exact approved positioning reference and authorized pilot-card save/reopen/retry. Never give ChatGPT a direct Supabase user credential.

Keep OAuth disabled until all resource guards are installed. Rollback begins by disabling OAuth issuance and revoking connection grants; retain audit/content history and the denial guards for outstanding tokens. Do not drop the role/grants while live tokens exist. No paid provider action, Claude connection or REL mutation is included.
