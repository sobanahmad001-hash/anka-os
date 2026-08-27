# Operating Spine review and release gate

Status: **branch-only; not approved for merge or deployment**

This gate covers the security remediation and Operating Spine implementation in:

- `20260827140000_operating_spine_security_remediation.sql`
- `20260827150000_operating_spine_core.sql`
- `supabase/functions/ai-chat`
- the minimal Engagements, Clients & Brands, and Service Catalogue UI

The implementation must remain in a pull request until Anka Sphere gives a
separate, explicit approval to merge and a second explicit approval to deploy.
Preview-build success is not deployment approval.

## What the review must confirm

1. Client, Brand, Engagement, and Service remain separate relational entities.
2. The catalogue contains 8 Content, 8 Design, 9 Development, and 9 Marketing
   services.
3. The composer requires a client, brand, at least one service, owners, dates,
   and optional existing assets.
4. A partial-service engagement receives only its selected service stages plus
   a short prerequisite stage when supplied context or an upstream selected
   stage cannot satisfy the prerequisite.
5. Verified connectors and AI runs are scoped by both engagement and department.
6. The legacy no-organisation tables listed in the security classification are
   unavailable to browser roles.
7. `can_access_task` requires active organisation membership before applying
   role, department, ownership, or assignment rules.
8. GraphQL resolution is disabled for browser roles. REST remains protected by
   explicit grants and RLS; a GraphQL table-grant advisory is therefore an
   expected static finding, not permission to weaken REST access.

## Evidence already required on the branch

Run from the repository root:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npx.cmd --yes deno check --frozen supabase/functions/ai-chat/index.ts
npx.cmd --yes deno test --frozen supabase/functions/ai-chat/index.test.ts
git diff --check
npx.cmd --yes supabase db push --linked --dry-run
```

The dry run must list only the two migrations named above. It must say that
migrations will not be pushed.

## Explicit decisions still required

- **Merge approval:** approve the pull request after code and security review.
- **Database deployment approval:** confirm backup/PITR, maintenance window, and
  the exact linked Supabase project before applying either migration.
- **Function deployment approval:** approve deployment of the revised `ai-chat`
  function only after the database migration succeeds.
- **Auth setting approval:** enable Supabase leaked-password protection in the
  dashboard. This is a project setting, not a SQL migration, and remains off
  until separately approved.
- **Frontend deployment approval:** approve only after database and function
  verification completes.

None of those approvals is implied by approving a Vercel preview.

## Controlled deployment order after approval

1. Confirm the linked project and create/confirm a recoverable backup.
2. Run `supabase migration list` and stop on any local/remote mismatch.
3. Run the dry run again and confirm only the two expected migrations.
4. Apply the migrations in timestamp order.
5. Run both `supabase/verify_20260827*.sql` files in SQL Editor.
6. Test a design-only engagement, a marketing-only engagement with supplied
   assets, and a full-cycle engagement. Confirm the resulting stages,
   prerequisites, dependencies, connector mappings, and audit events.
7. Run Supabase security and performance advisors; classify any residual
   finding before continuing.
8. Deploy `ai-chat`, then test AI access with an engagement/department mapping
   and confirm that an unmapped department is rejected.
9. Enable leaked-password protection after confirming the desired Auth policy.
10. Deploy the frontend and complete authenticated smoke testing.

If any verification fails, stop. Do not deploy the next layer and do not repair
migration history unless the database change was independently confirmed.
