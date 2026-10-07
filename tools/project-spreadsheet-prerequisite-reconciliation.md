# Synthetic QA prerequisite reconciliation — delta from dbce4d0

Local reports: archive SHA matched; all32 candidate files reconstructed after canonical LF normalization. Read-only inventory found no `storage.buckets` and no exact calendar scheduler. Other7 overloads present. No importer migration/native behavior ran; no pass is inferred.

## Calendar scheduler: exact repository source

`supabase/migrations/20260921121500_n5_m03_marketing_calendar_schedule.sql` is the authoritative complete definition. It creates `private.m03_schedule_requests`, its index/RLS/immutable trigger/grants and `public.schedule_marketing_calendar_entry(uuid,uuid,uuid,uuid,text,uuid,bigint,date,date,uuid)` returning JSONB, SECURITY INVOKER, empty search_path, service_role EXECUTE only. Review/install the authentic migration only in isolated synthetic QA after dependency inventory, not a rewritten scheduler.

Required existing helpers and their repository definitions:

| Helper | Repository source |
|---|---|
| `private.n1c_set_actor(uuid)`, `private.n1c_require_scope(uuid,uuid,uuid)` (and `private.n1c_actor(uuid)` transitively) | `20260919145156_n1c_assignment_enforcement.sql` |
| `private.n1c_can_assign_department(uuid,uuid,text,uuid)` | `20260919151214_n1c_project_department_participation.sql` (reconcile installed helper and governed authority before replay) |
| `private.p5_raise_stale_write(text,uuid,bigint,bigint)` | `20260904120000_p5_unified_planning.sql` |
| `private.p7_reject_history_mutation()` | `20260904130000_p7_governed_deliverable_release.sql` |

Tables: `auth.users`, public projects, engagements, organizations/memberships (through scope helper), engagement_services, service_catalog, tasks, work_items, task_dependencies, work_item_dependencies. Canonical task dependencies: `20260825040000_canonical_delivery_core.sql`; Work Item dependencies: `20260829081243_work_item_dependencies_subtasks.sql`. Task/Work Item row-version and date fields, bump triggers, dependency semantics and existing actor-scope machinery must match retained QA contracts. Inventory before installing; do not replay entire old migrations over retained fixtures merely to obtain one helper.

Runnable safe metadata inventory: `supabase/tests/project_chat_spreadsheet_import.scheduler_prerequisites.sql`. This uses pg_catalog/to_regclass so absent Storage relations do not cause a missing-table query error. Local reported production metadata all5 overloads/25 columns present; first4 functions invoker/service-only/empty search_path, audit helper retains broader pre-existing ACL. Production presence does not fill absent isolated QA contracts.

## Storage is a platform prerequisite, not an application table

No Anka repository migration defines `storage.buckets`. `supabase/migrations/20260911121056_p9_chat_private_attachments.sql` assumes authentic Supabase Storage schema; its first statement configures bucket `department-chat-attachments` as private,5MB, allowing plain text/Markdown/DOCX/PNG/JPEG. The importer migration adds CSV/XLSX MIME types while retaining privacy and bucket limit. Do not rerun the whole P9 migration over existing attachment tables.

Official Supabase Storage tenant baseline lives in `supabase/storage` upstream, including `migrations/tenant/0002-storage-schema.sql`. That initial file alone does NOT supply every later bucket column. Reconcile using the existing QA/Supabase platform's pinned Storage migration bundle, with its authentic subsequent `public`, `file_size_limit`, `allowed_mime_types` additions, ownership/grants/RLS and dependency setup. No miniature hand-written bucket substitute, new user, credentials, production/customer records or live object operations.

Exact coordinator action if platform SQL is unavailable: provide the approved pinned Supabase Storage tenant migration bundle/version or commit and checksums for this existing QA environment, or identify its established local distribution path. Required metadata: storage schema/table presence; bucket column names/types/defaults; PK/unique constraints; owner, grants/RLS; migration names/version. No bucket object rows, URLs, secrets or credentials. Local manager reviews authentic prerequisites and reports whether the private bucket config is absent separately from platform table absence. Run the guarded importer inventory only after those prerequisites are reconciled.

## Calendar create ownership approved and implemented

Soban explicitly approved new unassigned Marketing Engagement Work Items. The create-support delta adds stable reviewed `calendar_key` identities (blank `record_id`), canonical `public.save_work_item` with department marketing/type task/status not_started/assignee null, reviewed optional start/due dates, and no publication/approval. Original dates/timezones/channel/status remain private sourced evidence. Existing Tasks retain date-only support; new Tasks/campaign-plan records remain unsupported. Re-import keys map through existing private accepted proposal receipts to the original live Work Item; ambiguous/renamed/deleted targets and potential title duplicates require explicit resolution. Original proposal replay returns frozen results; separate stale creates are rejected under the existing project lock. No new importer table/model configuration/shared file authority.

Additive migration `20261006202317_project_chat_import_calendar_create.sql` replaces only importer save/confirm functions. Original two importer migrations remain byte-identical to dd3f1d4. Canonical create dependency: `public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,text)`, existing N1-C wrapper from `20260919151214_n1c_project_department_participation.sql`; its private body was renamed by `20260919145156_n1c_assignment_enforcement.sql` from the existing definition in `20260902000000_uw3_work_item_chat_proposals.sql`. Inventory those authentic helpers rather than creating substitutes. Scoped QA command `check-project-spreadsheet-native.py --calendar-create-only` selects the eight new assertions; concurrency runner accepts the same flag for competing create + locked revocation only. Both require the established guarded local QA prerequisites; execution is pending.

## Browser evidence correction and current implementation delta

Original dbce4d0 browser runner FAILED required mapping because synthetic headers used underscore names. Local supplemental explicit mappings passed1440/390 only as diagnostic evidence (six XML checks and actual worker load); unstyled overflow and lookup-incomplete rows mean no integrated acceptance. This remains a failure in the original evidence. Current code normalizes underscore headers to spaced aliases, preserves ambiguity detection, uses the actual Chat stylesheet in the fixture and adds alert/viewport assertions. These updates require a fresh affected browser run; no pass has been claimed.

Delta includes closed-gate private upload/confirmation/resume UI, original-source UUID recovery, proposal results, explicit bounded sample disclosure/classification, deterministic assisted-mapping validation, existing approved Project Chat runner integration and original UUID-only no-redispatch mapping recovery. Restricted sources cannot use provider mapping; mapping happens before private source reservation and never dispatches the attachment. Existing canonical context is excluded. Externally accessible actions stay closed by both frontend and server constants. No actual paid provider calls, new model configuration, schema/Edge deployment or customer workbook transfer. Original dbce4d0 migrations remain unchanged; the create delta adds the named importer-only migration; affected source mapping logic changed in both frontend/server shared module, so rerun only that focused compatibility slice.
