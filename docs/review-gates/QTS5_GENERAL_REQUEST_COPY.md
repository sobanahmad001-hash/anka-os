# QTS5 General Request copying — local review gate

## Admin native PostgreSQL concurrency addendum

Admin installed portable PostgreSQL 17.11 locally, restored a schema-only template with original owners/grants and synthetic reference rows, and applied the exact QTS5 migration only locally. Full 44-check verifier passed. The concurrency harness now explicitly verifies service_role in both competing sessions. Three independent runs observed actual advisory-lock contention, then one shared retry result, a distinct fresh-key copy and unchanged complete source row. All five named results returned true in each run. Cleanup confirmed zero fixture rows and zero qts5_verify_* databases; server stopped afterward. Full evidence: C:/Users/Soban/Documents/ChatGPT/Anka Sphere/.qa/QTS5_NATIVE_CONCURRENCY.md. This supersedes earlier native-runtime unavailable and concurrency NOT executed statements. Browser smoke, published-head CI, permanent apply/persisted schema, merge and deployment remain pending.

## Admin rollback preflight addendum

Under explicit user approval, Admin executed migration DDL and verifier together in a transaction ending ROLLBACK against fhoxaogfjszftoqtnbav. Corrected the verifier-only dummy connector name to ANKA_OPENAI_QTS5_TEST_ONLY to satisfy the existing constraint, and added a real service_role copy call. Final 44 named checks all true; eight separate cleanup checks confirmed no QTS5 table/RPC/ledger entry, fixture organizations/clients/brands/connector or failure triggers remained. Node460 and SQL/PLpgSQL parsing passed again. Migration implementation unchanged. Full results: C:/Users/Soban/Documents/ChatGPT/Anka Sphere/.qa/QTS5_ROLLBACK_PREFLIGHT.md. This supersedes historical NOT executed statements below only for rollback runtime verification. Two-session concurrency, authenticated browser smoke, published-head CI, permanent apply/persisted checks, merge and deployment remain pending.

Status: local implementation only. Publication and release are held. No push, PR, database connection, migration application, merge, deployment, or scheduler action was performed.

## Authority and baseline

The user explicitly approved reading QTS5_IMPLEMENTATION_BRIEF.md and implementing/testing locally. That brief supersedes the obsolete Department Chat rerouting proposal. The user separately chose **Leave migration ordering for Admin** after the generated timestamp discrepancy was disclosed.

Branch: qts5-general-request-copy.
Worktree: C:/Users/Soban/Documents/ChatGPT/Anka Sphere/anka-os-qts5.
Fetched origin/main and merge base: c30b4fab1cf95ed2eec88f7c211e05a2d9cd3607.
This is the RET3 merge, with QTS2–QTS4 ancestors. The worktree began clean at this SHA. Obtain the final local head with git rev-parse HEAD; the handoff includes that immutable commit.

Actual WCH3 diff at 427701c was inspected. None of the files below overlaps WCH3, PLN, or RET implementation. WCH's human confirmation into official drafts/work items is preserved. QTS4 remains the sole outbound canonical boundary FROM Quick Tasks.

## Behavior and mapping

An active member deliberately copies an existing General Request in their selected active organization. The server derives all content, actor, source, and brand checks; browser input is only action, organizationId, sourceRequestId, idempotencyKey. Unknown keys and malformed UUIDs fail.

The initial revision uses the existing notes/checklist sandbox shape:
- notes begins with the complete original brief, including leading/trailing whitespace and Unicode.
- Append two descriptive lines: Format and Output path (reference only).
- Append Brand reference only when source.brand_id is non-null and belongs to the same organization.
- checklist is empty. No assets, URLs, status, assignees, engagement, approvals, or execution semantics are imported.
- Display title is the first 120 characters of the trimmed brief; this is only an excerpt. Full brief remains in notes.
- Notes beyond 50,000 characters are rejected before writes. The current General Request limit is 12,000, so valid present sources fit without truncation.

The output path and brand UUID are inert text references in notes. They neither fetch context nor trigger connectors. Subsequent ordinary QTS edits retain the existing notes editor behavior.

An identical request/key returns the same task with current state and purge indicator. A new key creates a deliberate additional copy. Authorization and source/brand access are checked again before every replay. Old-key replay of a purged task returns a content-free tombstone result, never recreates it.

UI disables unavailable/wrong-organization access, prevents double submission, retains the key after transport uncertainty or malformed success responses, and makes a new copy require deliberate intent. User/org/scope changes remount the action; abort signals invalidate late results. Access statuses are passed to existing organization access handling. Existing General Request reads/creation/handoffs are untouched.

## Exact schema addition

One table: public.quick_task_request_copies.

| Column | Definition |
| --- | --- |
| organization_id | uuid NOT NULL |
| owner_id | uuid NOT NULL |
| idempotency_key | uuid NOT NULL |
| source_request_id | uuid NOT NULL |
| quick_task_id | uuid NOT NULL |
| created_at | timestamptz NOT NULL DEFAULT now() |

Constraints:
- PRIMARY KEY (organization_id, owner_id, idempotency_key): normalized actor/tenant request identity; also covers owner-scoped lookup.
- UNIQUE (quick_task_id, organization_id, owner_id): one origin ledger row per copied task; also indexes the task FK.
- FK (quick_task_id, organization_id, owner_id) to quick_tasks(id, organization_id, owner_id), ON DELETE RESTRICT.
- FK (source_request_id, organization_id) to content_requests(id, organization_id), ON DELETE RESTRICT.
- idx_quick_task_request_copies_source(source_request_id, organization_id) supports the source FK. No equivalent index exists on this new table, and no redundant owner/task index is added.
- Append-only UPDATE/DELETE trigger uses existing private.reject_quick_task_history_mutation. Its QTS3 purge exception applies only to revisions/messages, not this ledger.
- No new columns or policies on existing tables. No source revision FK. No schema version/provenance payload, checksum, URL, or copied text in this table.

RLS:
- Enabled before grants.
- One authenticated SELECT policy: owner_id=auth.uid() AND an active team membership for that same user/org AND organization.status='active'.
- No leadership content/reference override and no browser mutation policy.
- Revoke all default PUBLIC/anon/authenticated/service_role privileges.
- Grant authenticated SELECT only; service_role SELECT and INSERT only.

One RPC:
public.copy_general_request_to_quick_task(p_organization_id uuid, p_source_request_id uuid, p_idempotency_key uuid, p_actor_id uuid) RETURNS jsonb.
- SECURITY INVOKER, fixed empty search_path.
- EXECUTE revoked from PUBLIC/anon/authenticated; granted only to service_role.
- Edge Function binds p_actor_id from existing verified getUser authentication. SQL does not trust a browser actor.
- Locks selected active organization, active team membership, General Request and optional same-org brand FOR SHARE so concurrent revocation/deactivation cannot change authorization mid-transaction.
- Transaction-scoped advisory lock on organization/actor/key serializes concurrent retries. Hash collisions only serialize unrelated work; the full composite key still governs identity.
- Replay loads only the matching owner/tenant task and returns IDs/state/purged/replayed; it does not update deadlines.
- New copy atomically inserts task, initial revision/checksum/source_kind, ordinary content-free created event, and ledger.
- No new privileged helper, canonical RPC, connector, enum extension, function registration, deployment entry or scheduler.

## Purge impact

No change to QTS3 purge code. Task title, notes (including format/path/brand), revisions, messages, and linked QTS AI copies use its existing erasure path. The ledger has no revision FK and therefore cannot block revision deletion. It preserves only six content-free fields, scoped to the owner and active organization.

The source FK deliberately prevents deleting/re-keying the source while provenance exists. It does not grant access to that source and introduces no source mutation path. A future change to General Request deletion/retention would need separate review; this phase preserves its existing durable operational role.

## Migration ordering reconciled by Admin

Supabase CLI generated 20260903173419_qts5_general_request_copy.sql locally using migration new. The local clock sorts it BEFORE merged RET3 20260903185206 and unmerged WCH3 20260903235243. No existing migration was edited.

Admin read the live ledger and confirmed its latest version is RET3 20260903185206; QTS5 has no live table or RPC. The unapplied migration and verifier are renamed to 20260903185207, the unused next position after RET3, with the test path and references updated. Migration SQL behavior is unchanged; only its introductory comment changed. No applied file or ledger was edited, and no include-all override was used. Recheck main and the ledger before application if another phase lands first. Runtime SQL, concurrency, hosted CI and browser checks remain open gates.

## Requirement-by-requirement evidence

| Brief requirement | Implemented evidence | Execution status |
| --- | --- | --- |
| 1. Auth, roles, tenants, active selected org | Deno rejects missing auth, injected fields; verified actor binding; SQL active org/team checks; verifier client-kind privileged role, revoked/suspended membership, inactive org, nonmember, owner/key isolation, source/brand negatives, actual authenticated/anon RPC and RLS paths | Deno passed; database scenarios authored, NOT executed |
| 2. Server mapping/source preservation | Only server-read source fields; verifier exact branded and 12,000-character unbranded payloads; full JSON snapshots of requests/assets/media and canonical rows | Static review and syntax passed; database comparisons NOT executed |
| 3. Atomicity/concurrency | Advisory lock and composite key; verifier failures injected at each of four insert boundaries; dedicated two-session test observes a waiting advisory lock and asserts one task/revision/ledger, fresh-key separation | SQL/harness parsed and type-checked; real sessions NOT executed |
| 4. Lifecycle/purge | Verifier preserve/unpreserve, discard/restore, due expiry/recovery, early purge denial, closed recovery, AI success + messages then purge, retained reference, no old-key resurrection, terminal promoted exclusion | Inherited QTS tests passed; copied-task DB matrix NOT executed |
| 5. No canonical effects | Node allowlists exactly four sandbox INSERT targets and rejects canonical/connector calls; verifier compares complete rows across 20 canonical/source tables; existing QTS4 tests unchanged | Node/Deno passed; database snapshot NOT executed |
| 6. Existing consumers preserved | Only two-line General Panel integration; contentRequestsRepository, WCH, AnkaAssistant, PLN and RET implementation unchanged; existing full suites | Passed Node and all CI-configured Deno suites |
| 7. UI races/retries/scope | Controller tests double-submit, uncertain retry, fresh intent, late success/failure, disposal, StrictMode lifecycle, malformed success, purged response; UI keys user/org/scope and checks source org; no new root query | Node passed; no authenticated browser smoke claimed |
| 8. SQL/catalog/ACL | PostgreSQL 18 libpg-query parsing plus PL/pgSQL body parsing; verifier exact columns, PK, composite FK columns, valid unpredicated supporting index prefixes, ACLs, invoker/search_path, RLS expression/role | Syntax passed; actual installed catalogs NOT checked |
| 9. Rollback verifier | Named checks, fails on false, outer BEGIN/ROLLBACK; temporary helpers/triggers; no permanent fixtures | Authored; native PostgreSQL/Docker/Podman unavailable |
| 10. Full validation/current main | Full Node 460/460; Deno 147/147 and full frozen CI check list; lint zero errors, 349 repository warnings; build and diff checks; main/base refreshed | Local passed; hosted PR CI unavailable because no push/PR authorized |

## Local validation tools and commands

- npm ci --ignore-scripts used the existing lockfile; no dependency/lockfile change.
- npm test: 460 passed.
- npm run lint: 0 errors, 349 warnings.
- Changed JavaScript files: 0 lint errors; three JSX usage warnings (one existing imported panel, two new JSX component usages). The repository ESLint setup does not recognize these JSX uses for no-unused-vars; the production build resolves them successfully.
- npm run build: passed.
- Existing .github/workflows/ci.yml Deno test and check argument lists executed unchanged with --frozen: 147 tests passed and all checks passed. Affected quick-tasks suite: 18 passed.
- Deno runner: 2.9.6, supplied temporarily through npm exec; application dependencies unchanged.
- git diff --check passed.
- scripts/qts5-parse-sql.ts uses pinned libpg-query 18.1.4. Parsing the migration and verifier passed, including one RPC body and five verifier PL/pgSQL bodies. Parsing does not prove target PostgreSQL catalog compatibility or runtime behavior.
- scripts/qts5-concurrency.ts and parser type-check passed.

For independent syntax repeat:
    deno run --no-config --no-lock --allow-read scripts/qts5-parse-sql.ts supabase/migrations/20260903185207_qts5_general_request_copy.sql supabase/verify_20260903185207_qts5_general_request_copy.sql

For authorized local database review, Admin prepares a disposable complete-schema database. Run the SQL verifier with stop-on-error and retain every named result. The script always ends ROLLBACK when successful; on error, connection closure or explicit ROLLBACK must discard its transaction.

For independent concurrency execution, scripts/qts5-concurrency.ts requires QTS5_LOCAL_TEMPLATE_URL pointing to an explicitly prepared LOCAL database named qts5_template_*. It rejects remote hosts, URL options and fragments. It clones that local template to a random qts5_verify_* database, runs actual competing sessions, then drops only the generated database. It does not apply migrations. Its pinned pg client is 8.23.0. Use explicit localhost-only network permissions and environment/read permissions as required by Deno. No URL/credentials were configured and this script was not executed in the principal task.

## Owned file list

- src/components/GeneralContentRequestsPanel.jsx
- src/components/GeneralRequestQuickTaskCopy.jsx
- src/data/quickTasksRepository.js
- src/data/quickTaskCopy.js
- src/data/quickTaskCopy.test.js
- supabase/functions/quick-tasks/index.ts
- supabase/functions/quick-tasks/index.test.ts
- supabase/migrations/20260903185207_qts5_general_request_copy.sql
- supabase/verify_20260903185207_qts5_general_request_copy.sql
- scripts/qts5-parse-sql.ts
- scripts/qts5-concurrency.ts
- docs/review-gates/QTS5_GENERAL_REQUEST_COPY.md

## Admin stop/go

Do not release on this packet alone. Recheck ordering and main/overlap, execute the native PostgreSQL verifier and concurrent sessions, run authenticated browser smoke, and obtain hosted CI at the published commit. Any false result or scope/ownership conflict stops release. No live fallback or release action is authorized by this local implementation task.

Supabase guidance informed explicit grants/RLS and the fixed invoker boundary; it did not authorize any database execution. Current official references:
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/changelog?types=breaking-change
