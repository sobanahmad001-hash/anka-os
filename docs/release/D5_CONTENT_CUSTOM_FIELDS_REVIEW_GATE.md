# D5 Content Custom Fields — Review Gate

## Release boundary

- Built from current `origin/main` in the isolated `feat/content-custom-fields` branch.
- Do not merge, apply the migration, or deploy `content-studio` or the frontend before explicit sign-off.
- D5 changes only Content custom-field concerns. It does not change `work_items`, `work_item_dependencies`, or W-series files.

## Intended change

- Add organization-scoped custom-field definitions for every Content artifact type.
- Store values against one immutable `artifact_version_id`; values never carry forward automatically.
- Support text, number, date, single-select, multi-select, and checkbox values.
- Validate value types, select options, tenant keys, and definition/artifact type agreement in PostgreSQL.
- Seed `word_count`, `seo_score`, `target_keyword`, and `channel` definitions for the `content` artifact type.
- Let Content editors define fields in Settings and edit values on an exact version in Content Studio.
- Keep browser access read-only and route writes through the existing Content authority boundary.

## Required review checks

- [ ] Both new tables have exactly the scoped columns and tenant-safe foreign keys.
- [ ] Definition names are unique per organization and artifact type.
- [ ] Select definitions require unique, non-empty options; non-select definitions reject options.
- [ ] Number fields reject text and single-select fields reject values outside their options.
- [ ] A `content` definition cannot be assigned to a `campaign_brief` version.
- [ ] Values are stored on an exact version and are not copied when another version is created.
- [ ] Custom-field writes do not insert, update, or delete `artifact_approvals`.
- [ ] Team members can read their organization definitions and values through RLS.
- [ ] Anonymous users cannot access either table and authenticated browser clients cannot write them directly.
- [ ] Settings supports definition creation for all eight Content artifact types.
- [ ] Content Studio renders and edits every supported field type for a selected exact version.
- [ ] No Work Item surface, computed formula, automatic metric, or field-level permission model is added.

## Verification

```powershell
npm test
npm run lint
npm run build
npx deno test --no-config supabase/functions/content-studio/index.test.ts
npx deno check --no-config supabase/functions/content-studio/index.ts
npx supabase db push --dry-run --linked
git diff --check origin/main...HEAD
git diff --name-only origin/main...HEAD
```

After applying D5 to an isolated review database, run the rollback-safe verifier:

```sql
\i supabase/verify_20260829101716_content_custom_fields.sql
```

Every JSON result must be `true`, especially `number_field_rejects_text`,
`single_select_rejects_unknown_option`, `content_field_rejects_campaign_brief_version`,
and `custom_value_write_does_not_approve`.
