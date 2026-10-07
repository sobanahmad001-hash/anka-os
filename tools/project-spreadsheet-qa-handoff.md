# Project Chat importer: synthetic verification handoff

This is a test handoff, not a competing product scope document. Approved September 30 source IDs and release overrides remain authoritative. Architecture approvals are settled. Website imports append unapproved architecture drafts; ordinary approval and registration remain separate. Private source history never becomes publication or assignment authority.

Candidate: `feature/project-chat-spreadsheet-import-20261006`; use the commit containing this file and record `git rev-parse HEAD` in returned evidence. Parent checkpoint: `b10351ac9b47363ce707aa7bcaafcb7c48c4b494`. PR284 released main `9703e288096fe84433f02aa29b4ac966c4a12973` integrated without conflicts at merge `bc28704f872b3b6358b7d33a1886bfb42849b58a`. Importer implementation files remained byte-for-byte unchanged by the merge. No merge, deployment or production import is part of this handoff.

## Candidate delta and ownership

Apply exactly these three migrations in order in isolated QA only:

| Migration | Delta |
|---|---|
| `20261006152330_project_chat_spreadsheet_private_sources.sql` | Discriminated Project Chat private CSV/XLSX references in existing attachments; same ownership, paths, limits and failure retention; reservation, single-flight claim and finalize receipts; bucket MIME addition only |
| `20261006154628_project_chat_spreadsheet_proposals.sql` | Discriminated provider-free proposals and durable row receipts in existing proposals; private save/recover/confirm; unapproved canonical artifact version or existing calendar scheduler; exact parent/row checks; import-aware audit |

Importer owns new `project-chat-import/`, `_shared/projectSpreadsheet*`, frontend `projectSpreadsheet*` and these two migration/test files. Shared SQL replacement: **`private.audit_department_chat_proposal()` only**. Existing provider audit semantics are retained. Existing attachment/proposal constraint extensions are within the approved importer ownership. No activation reserved files or hunks changed: department-chat capabilities, workshop transport gate, integration-gateway mapping actions, Workshop model mapping UI/data and activation migration remain with local manager. Existing `private.protect_department_chat_model_binding()` is not replaced.

`IMPORT_RELEASE_READY=false` in the endpoint. Current panel remains local inspection only; remote upload/confirmation and resume UI are not enabled. Native success alone does not open these gates. AI-assisted mapping has bounded consent/validation foundations but no paid/live provider acceptance; do not call it accepted. New calendar records remain proposals: this adapter only changes reviewed dates of selected existing Marketing Task/Work Item identities. Keyword imports use canonical V2 plans and exact architecture targets; legacy keyword migration needs separate review.

Calendar create delta: apply `supabase/migrations/20261006202317_project_chat_import_calendar_create.sql` after the two original importer migrations. No provider or shared model function changes. Use the existing native runner arguments plus `--calendar-create-only` for the eight affected create assertions; use the concurrency runner's same flag to skip unchanged architecture tests. The concurrency setup now includes the third migration; do not reinstall over retained fixtures. In an already prepared disposable QA copy, apply only this additive migration after inventory, preserving previous fixtures.

## Existing PostgreSQL17.11 QA path

Use the existing local server, established synthetic database `anka_b1_firstsend_20260930`, existing PostgreSQL `psql`, exact known port/data directory and existing administrative QA login. No production URL, secret transfer, new users, new server or customer fixture. Python 3 standard library suffices for rollback runner. Never guess port, data directory or authority anchors.

From repository root, substitute established local values in these commands:

```sh
python tools/check-project-spreadsheet-native.py --psql <existing-psql-path> --port <qa-port> --database anka_b1_firstsend_20260930 --expected-data-directory <exact-qa-data-directory> --inventory
python tools/check-project-spreadsheet-native.py --psql <existing-psql-path> --port <qa-port> --database anka_b1_firstsend_20260930 --expected-data-directory <exact-qa-data-directory> --evidence <local-evidence-dir>/importer-native.json
```

Inventory is read-only and aborts execution if prerequisites are missing. It requires these exact installed overloads:

```text
private.can_edit_content_artifacts(uuid,uuid)
private.n1c_require_scope(uuid,uuid,uuid)
private.n1c_can_assign_department(uuid,uuid,text,uuid)
public.schedule_marketing_calendar_entry(uuid,uuid,uuid,uuid,text,uuid,bigint,date,date,uuid)
public.fail_department_chat_attachment(uuid,uuid,text,text,text)
private.protect_department_chat_model_binding()
private.protect_department_chat_proposal()
private.audit_department_chat_proposal()
```

Relevant existing tables: conversations, attachments, proposals, artifacts, artifact_versions, artifact_approvals, department_chat_audit_events, engagement_events, projects, engagements, tasks, work_items, organization_memberships, organizations, engagement_services, service_catalog and storage.buckets. Calendar also uses its existing scheduler dependency/receipt tables from `20260921121500_n5_m03_marketing_calendar_schedule.sql`. Candidate migrations must find the original named Chat constraints and FK identities; missing contracts are errors, not permission to fabricate a replacement schema.

Required synthetic anchors are existing organization `99999999-9999-4999-8999-999999999901`, actor `…9902`, project `…9974`, engagement `…9975`, architecture template `99999999-9999-4999-8999-999999997140`, active Content/Marketing services and appropriate existing actor authority. Full IDs are in runner/SQL. If any anchor is missing, return the failed Boolean and exact table/function name; do not create users or import production data.

Fixture namespace is `8f000000-0000-4000-8000-0000000000xx`: chat01, attachment02, architecture03/version04, website requests05/07, calendar request06/task20, keyword root30/version31/requests32/33, concurrency requests40/41;99 is a nonexistent negative identity. Fixture source bytes are a literal synthetic string; native attachment metadata does **not** establish actual Storage upload or browser proof.

Rollback runner applies all three migrations and fixtures inside ONE outer transaction, enforces five-second lock/120-second statement bounds, then rolls back all schema/fixture/authority changes. It compares before/after counts, bucket and model/audit definitions, membership and archive state. On SQL error the connection exits, rolling back. Return the sanitized error/SQLSTATE and failed assertion, not rows/credentials. Expected at least30 named assertions cover source lifecycle, MIME/privacy, changed payload, claim conflict, exact retry, zero preview writes/AI runs, stale parent, no approval/registration, private historical evidence, keyword target constraints, calendar partial outcomes, no successful-row repetition, grants, revocation and archived replay denial.

## Two-session concurrency gate

Both sessions must see candidate functions, so use a **disposable synthetic database copy on the same existing server**, e.g. `anka_importer_qa_20261006`, made only from the established synthetic QA database by local manager. This is not another server/environment installation. Keep the shared QA database unchanged. Do not use a production database/template. If the established QA cannot be copied while occupied, local manager chooses an idle window; do not terminate others' sessions.

After successful prerequisite/rollback verification, local manager creates that copy using their existing administration procedure. Run from repo root:

```sh
<existing-psql-path> -X -w -h 127.0.0.1 -p <qa-port> -U <qa-user> -d anka_importer_qa_20261006 -v qa_data_directory=<exact-qa-data-directory> -f supabase/tests/project_chat_spreadsheet_import.concurrency_setup.sql
python tools/check-project-spreadsheet-concurrency.py --port <qa-port> --database anka_importer_qa_20261006 --expected-data-directory <exact-qa-data-directory> --user <qa-user> --evidence <local-evidence-dir>/importer-concurrency.json
```

Concurrency runner additionally requires existing Python `psycopg2` (use the QA runner environment already providing it; if absent, report that exact module prerequisite). It opens two local sessions with bounded timeouts. Expected: simultaneous confirmation produces exactly one version and one frozen replay; a confirm waits on the locked membership row, then denies the write with42501 after committed revocation. It restores synthetic membership even on failure. Copy/fixture state is retained for inspection; this package performs no database deletion. Do not rerun setup over existing fixtures or replay candidate migrations over installed candidate columns.

## Permitted browser XLSX path

Cloud localhost was blocked by browser network policy. Do not tunnel, expose a customer session, deploy a preview to evade policy, or assume browser acceptance from Node XML tests. Use local manager/user's **permitted local browser on the machine running Vite**. No sign-in or Supabase connection is needed.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run dev -- --host 127.0.0.1 --port 5178 --strictPort
# In another local terminal, using an ALREADY installed Playwright module/browser:
node tools/check-project-spreadsheet-browser.cjs <absolute-playwright-module-path> <local-evidence-dir>
```

Set `IMPORTER_HEADFUL=1` if supervised visible Chromium is preferred. The runner accepts only localhost5178 traffic, opens `tools/check-project-spreadsheet-browser.html`, runs six XML/security checks and uploads a generated synthetic XLSX through the actual file input/worker. Desktop1440 and mobile390 verify hidden-sheet exclusion, actual row preview, absent upload/confirm controls, no remote requests/page errors and screenshots. No customer workbook, new user, provider call or production write. Browser evidence JSON explicitly states its limits. If Playwright/browser is unavailable, exact coordinator action is to use an existing permitted browser runtime on that local machine; do not install a duplicate server or change cloud network controls.

## Current evidence and remaining gates

At pre-merge importer implementation commit8403a85 (implementation unchanged by PR284 integration):38 importer tests passed, plus one subsequently added server checksum/reconstruction test passed (39 importer cases total);25 affected Project Chat mounted cases passed. Affected JS lint and Vite production build passed. SQL and PL/pgSQL syntax parsed for both migrations and native behavior SQL; Python runners and browser JS syntax compile. These are local candidate evidence, **not** native execution, Edge deployment, browser acceptance, provider testing or signed-in human acceptance.

Return native inventory/evidence, two-session evidence, and browser JSON/screenshots against exact checked-out commit. Additional installed production calendar/helper compatibility is not in the approved8-table/9-function catalog. Exact minimal read-only request is **`supabase/tests/project_chat_spreadsheet_import.prerequisites.sql`**: five named overloads (including the shared audit helper), presence/security/grants/definition SHA256, and the explicitly listed projects/tasks/work_items column types/nullability only. No customer rows, function bodies, credentials or broad dump. Coordinator can relay this bounded metadata request to local manager. Activation/model tests are unaffected and must not be repeated.

Next release is explicit coordination after native/security/browser/installed-contract gates, endpoint runtime verification and integrated gated UI/recovery review. No automatic merge/deployment is authorized by a clear release slot. Keep source upload/confirmation closed while these remain pending.
