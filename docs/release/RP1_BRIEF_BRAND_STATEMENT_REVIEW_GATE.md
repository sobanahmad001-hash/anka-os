# RP1 Brief and Brand Statement review gate

RP1 is a review-only change. A green preview is not permission to merge, apply
the migration, deploy an Edge Function, or promote the frontend.

## Architecture decision

- `brand_briefs` is the single mutable working record for a brand. Content team
  edits replace the fields on that row and update `updated_at`; they do not add
  brief history rows.
- `brand_statement` reuses the canonical `artifacts`, immutable
  `artifact_versions`, exact `artifact_approvals`, proofing, relations, and audit
  path. There is no parallel statement or approval table.
- The source brief named `discovery_facilitation`, `vision_positioning`, and
  `audience_research`; those are service slugs in the current product. RP1 maps
  them to the existing artifact types `discovery`, `vision`, and `audience`.
- RP1 and Design Workshop call one shared approved-context compiler. A compiled
  version stores the exact artifact version IDs, approval IDs, checksums, source
  content, and a snapshot of the current brand brief in `source_manifest`.
- Compilation is a deliberate Content Studio action. It is deterministic and
  internal; it does not create a new AI or connector call and never regenerates
  automatically after a brief or source approval changes.

## Security review

- Confirm `brand_briefs` has organization-scoped RLS and only an authenticated
  team-member SELECT policy.
- Confirm browser roles have no INSERT, UPDATE, or DELETE grant. Authorized
  Content Studio writes go through the existing authenticated Edge Function and
  its active-team and active-Content-service checks.
- Confirm `brand_briefs` has no immutability trigger, while
  `artifact_versions` retains its append-only trigger.
- Confirm the composite `(brand_id, organization_id)` foreign key prevents a
  cross-organization brand reference.

## Product verification

- [ ] The RP1 SQL verifier returns only `true` values after applying the
      migration to a review database.
- [ ] Save a new brief, edit it, and confirm the same brief ID remains and the
      row count for the brand is still one.
- [ ] Confirm compilation remains disabled until a brief and approved
      Discovery, Vision, and Audience sources exist for the brand.
- [ ] Compile a statement and inspect its source manifest for the exact three
      approved version IDs and the current brief snapshot.
- [ ] Edit the compiled statement and confirm a new immutable artifact version
      is created without changing the previous version.
- [ ] Approve the reviewed exact version through the standard approval panel;
      add a proofing comment and an artifact relation through the standard RP1
      surface.
- [ ] Create a newer approved source version and confirm an existing statement
      does not change until a user explicitly compiles another version.
- [ ] Confirm Department Chat still offers only the existing eight Content
      artifact types and cannot generate `brand_statement`.
- [ ] Application tests, lint, Deno tests, and the production build pass.
- [ ] The diff contains no RP2 sitemap, RP3 keywords/content, RP4 design,
      connector, publishing, or broader Raahbaan UI work.
- [ ] Nothing is merged or deployed without separate approval.

## Publish sequence after approval

1. Apply `20260831100748_rp1_brand_brief_statement.sql` to a review database.
2. Run `verify_20260831100748_rp1_brand_brief_statement.sql` and complete the
   product checks above.
3. Deploy the updated `content-studio`, `design-workshop`, `department-chat`,
   and `proofing-layer` functions to review.
4. Deploy the frontend preview and repeat the exact-version trace test.
5. Merge and publish only after explicit production sign-off.
