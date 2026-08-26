# Anka Sphere OS Release 1 Deployment Runbook

Target Supabase project: `fhoxaogfjszftoqtnbav`

This runbook starts only after the build branch has been reviewed. Keep Supabase **Deploy to production** disabled until the migration-history repair and dry run are complete.

## 1. Pre-deployment gates

From the repository root:

```bash
npm ci
npm run lint
npm test
npm run build
```

Required result:

- Lint: zero errors.
- Tests: all passing.
- Production build: passing.
- No privileged `VITE_*` provider credential in `src/`.
- Client approvals, AI assistance, and read-only external integration tests are enabled for controlled UAT.

Create a database backup or confirm point-in-time recovery before applying migrations.

## 2. Link the CLI without sharing credentials

Authenticate through Supabase locally, then link the exact project:

```bash
supabase login
supabase link --project-ref fhoxaogfjszftoqtnbav
supabase migration list
```

Never paste the access token, database password, service-role key, provider token, or application password into chat or Git.

## 3. Confirm migration history

Migrations through `20260825130000` were confirmed locally and remotely on 26 August 2026. Re-check before every deployment:

```bash
supabase migration list
```

Stop if any local and remote version differs. Do not repair migration history unless the SQL was independently applied and verified.

Run a dry run:

```bash
supabase db push --dry-run
```

For the department connector release, the only migrations that may appear—if not already present remotely—are:

- `20260826135713_department_connector_registry`
- `20260826141452_index_department_connector_foreign_keys`

Stop if an older migration appears.

## 4. Apply the queued database migrations

```bash
supabase db push
supabase migration list
```

Run both connector verification files through SQL Editor. Confirm department mappings, RLS, grants, and foreign-key indexes before deploying the frontend.

## 5. Configure Edge Function secrets

Required for AI:

- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`
- Optional `OPENAI_MODEL` or `ANTHROPIC_MODEL`

Release 1 integration credentials use connection-specific names. Examples:

- `ANKA_GITHUB_PRIMARY`
- `ANKA_FIGMA_PRIMARY`
- `ANKA_WORDPRESS_CLIENTNAME`
- `ANKA_OPENAI_PRIMARY`

Add values through Supabase Edge Function Secrets. The Anka OS Integration screen stores only the matching environment-variable name and public connection metadata.

Any provider credential previously exposed through a browser `VITE_*` variable must be rotated before it is added as an Edge Function secret.

## 6. Deploy authenticated Edge Functions

Deploy the functions declared in `supabase/config.toml`:

```bash
supabase functions deploy invite-user
supabase functions deploy ai-chat
supabase functions deploy invite-client-contact
supabase functions deploy portal-file-url
supabase functions deploy integration-gateway
```

All five functions must retain JWT verification.

The retired `hf-proxy` and `kling-proxy` functions are excluded from Release 1. If either exists remotely from an older deployment, delete it in the Supabase Dashboard before UAT.

## 7. Integration setup

In Anka OS Admin → Connectors:

1. Add public metadata for OpenAI, GitHub, Figma, or WordPress.
2. Select every department allowed to use the connection.
3. Enter only the Supabase secret name—not its value.
4. Run **Test connection**.
5. Confirm an immutable `integration_events` audit record exists.

Connector tests are read-only. They cannot push code, modify Figma, publish WordPress content, run an OpenAI generation, or expose provider responses. Google Analytics, Search Console, and Ads remain labelled **OAuth planned** until their consent flows are implemented.

## 8. Frontend deployment

Deploy the Vite application only after the database and Edge Functions pass verification. The frontend host needs only:

- `VITE_SUPABASE_URL=https://fhoxaogfjszftoqtnbav.supabase.co`
- `VITE_SUPABASE_ANON_KEY` or the project publishable key

Never configure a service-role key or provider credential as a frontend environment variable.

## 9. UAT order

1. System owner signs in and invites a team member.
2. Create one test client and project using a workflow template.
3. Complete a task through the enforced review lifecycle.
4. Create a deliverable version and record internal quality approval.
5. Release that exact version to a test client.
6. Client opens the released file, adds a version-specific comment, and submits a revision request.
7. Confirm the assigned team queue, notification, activity event, and Living Project Record update.
8. Verify a second client cannot read the project.
9. Verify client reports contain no tasks, research, internal activity, prompts, provider data, or costs.
10. Approve the exact released version and confirm the portal item and deliverable both show `client_approved`.
11. Repeat with a second version using **Request revision** and confirm it shows `revision_requested`.

## 10. Production automation

After the first controlled deployment succeeds:

1. Push the reviewed branch and open a pull request.
2. Require CI and Supabase checks before merge.
3. Merge to `main`.
4. Enable Supabase **Deploy to production** for future migrations.

From that point onward, do not make remote schema changes directly in SQL Editor. Every change must be committed as a migration.
