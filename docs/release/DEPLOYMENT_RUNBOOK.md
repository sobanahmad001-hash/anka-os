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
- Client approvals remain disabled.

Create a database backup or confirm point-in-time recovery before applying migrations.

## 2. Link the CLI without sharing credentials

Authenticate through Supabase locally, then link the exact project:

```bash
supabase login
supabase link --project-ref fhoxaogfjszftoqtnbav
supabase migration list
```

Never paste the access token, database password, service-role key, provider token, or application password into chat or Git.

## 3. Repair the manually applied migration history

Migrations 1–5 were executed and verified through SQL Editor. Mark those versions as applied without executing their SQL again:

```bash
supabase migration repair 20260825010000 20260825020000 20260825030000 20260825040000 20260825050000 --status applied
supabase migration list
```

Do not mark Migrations 6–11 applied. They have not been deployed yet.

Run a dry run:

```bash
supabase db push --dry-run
```

The dry run must list only:

- `20260825060000_team_profile_alignment`
- `20260825070000_release1_workflow_templates`
- `20260825080000_canonical_activity_notifications`
- `20260825090000_ai_audit_and_human_control`
- `20260825100000_secure_integration_gateway`
- `20260825110000_version_review_annotations`

Stop if Migrations 1–5 appear in the execution plan.

## 4. Apply the queued database migrations

```bash
supabase db push
supabase migration list
```

Run verification files 6–11 in order through SQL Editor. Each must return its expected migration identifier with no missing table, policy, trigger, column, or grant failure.

## 5. Configure Edge Function secrets

Required for AI:

- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`
- Optional `OPENAI_MODEL` or `ANTHROPIC_MODEL`

Release 1 integration credentials use connection-specific names. Examples:

- `ANKA_GITHUB_PRIMARY`
- `ANKA_FIGMA_PRIMARY`
- `ANKA_WORDPRESS_CLIENTNAME`

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

In Anka OS Admin → Rules / Secure Integrations:

1. Add public metadata for GitHub, Figma, or WordPress.
2. Enter only the Supabase secret name—not its value.
3. Run **Test connection**.
4. Confirm an immutable `integration_events` audit record exists.

Release 1 integration tests are read-only. They cannot push code, modify Figma, publish WordPress content, or expose provider responses.

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
10. Keep formal client approval disabled until this UAT passes with no P0/P1 defect.

## 10. Production automation

After the first controlled deployment succeeds:

1. Push the reviewed branch and open a pull request.
2. Require CI and Supabase checks before merge.
3. Merge to `main`.
4. Enable Supabase **Deploy to production** for future migrations.

From that point onward, do not make remote schema changes directly in SQL Editor. Every change must be committed as a migration.
