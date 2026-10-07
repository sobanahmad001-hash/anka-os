# Actual nonproduction Storage API and importer HTTP handler gate

The PostgreSQL17.11 rollback/concurrency evidence for f43aa8d is accepted as relayed. Reuse it: this UI/HTTP delta changes no migrations or native save/confirm function bodies. PostgreSQL catalog copies do not constitute a Storage API service. Original dd3f1d4 mobile browser runner failed at390px (scrollWidth423); diagnostic overrides were not acceptance. Both remain accurately recorded.

## Supported runtime and precise coordinator action

Use an **existing, independently reviewed local Supabase QA runtime** with authentic Auth, Storage API, API gateway/PostgREST and the synthetic fixture database. Official Supabase CLI local development supplies these services together; a standalone PostgreSQL server does not. References: https://supabase.com/docs/guides/local-development and https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl . Do not launch `supabase start`, reset databases, provision new users/infrastructure or deploy merely to evade browser restrictions under this handoff.

Local manager: report only whether that existing runtime is available, its loopback API port, pinned service images/version and confirmed isolated database/fixture lineage. Verify the existing private department-chat-attachments bucket (5MB, CSV/XLSX allowed), all three authentic importer migrations and retained QA chat/source anchors. Do not send keys, JWTs, object/customer rows or full status/config dumps. If there is no existing Auth/Storage runtime, report **“No authentic isolated Supabase Auth/Storage API runtime available”**; provisioning a new full local QA stack then needs separate explicit infrastructure authorization. A new Storage table substitute is not an option.

The established local runtime must already have a usable synthetic actor session for999...902, organization999...901, project999...974 and owned Project Chat8f...001. Reuse its locally configured nonproduction credentials/session without retrieval, minting a bypass token, credential transfer, new users or production login. If that session is absent, report that exact separate Auth prerequisite. The runner never acquires credentials.

## Runnable actual API package

Local manager supplies already configured private local-only process environment: `IMPORTER_QA_URL` (http://127.0.0.1:<approved-port>/), `IMPORTER_QA_ANON_KEY`, `IMPORTER_QA_SERVICE_KEY`, `IMPORTER_QA_ACCESS_TOKEN`. Set `IMPORTER_QA_RUNTIME_APPROVED=synthetic-local-storage` only after independent runtime/fixture review. No values go into the artifact, command line, evidence or chat.

From the exact reconstructed candidate checkout, using its installed Node runtime/dependencies:

```sh
node tools/check-project-spreadsheet-storage-api.mjs outputs/importer-storage-api/evidence.json
```

The tool denies non-loopback origins and redirects. It verifies a real existing Auth session, invokes the **actual importer HTTP handler** with real Auth/SQL/Storage clients inside the local harness, and exercises actual CSV and XLSX signed uploads, duplicate-upload denial, server download/parse/copy/finalization, exact original recovery, hash integrity, private reference-only metadata and anonymous final-object read denial. The production Edge entry and frontend gate constants remain false. The local harness injects its test capability only; it does not deploy/start an endpoint or modify production flags. This proves handler semantics with actual API services when executed; deployed Edge runtime/network acceptance remains separate.

No canonical confirmation or provider call is made by this Storage test. New UUID source objects/receipts are **synthetic QA-only and retained**, with sanitized fixture IDs/hashes in evidence. There is no object deletion, customer workbook, production object, assignment, approval or publication. If a stage fails, keep the fixture and return only the sanitized stage/SQLSTATE/status for diagnosis, not credentials or signed URLs.

## Browser acceptance scope

Run the updated `tools/check-project-spreadsheet-browser.cjs` against the permitted local Vite preview on127.0.0.1:5178 using the established local browser. Its1440/390 runs verify actual XLSX file input/worker, scoped drawer viewport, named workstream selection, readable before/after review/results, same-tab lost-response recovery and recovery affordance after reload without source reselection. The integrated UI fixture explicitly mocks upload/persistence/confirmation and uses the actual server parser for preview. That evidence is **offline UI acceptance only**, never actual Storage/native/live/provider acceptance. No diagnostic override of importer production CSS is included. Browser execution for this delta is pending; no cloud localhost restriction is bypassed.

For full signed-in end-to-end importer acceptance after the actual API gate, use the reviewed nonproduction runtime and original synthetic actors; independently verify the enabled **QA-only** frontend/endpoint wiring through its existing supervised preview route. Production upload/confirmation remain closed until every required installed/security/browser/endpoint/release gate passes and coordinated release is explicitly agreed.
