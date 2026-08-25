# Canonical RLS Matrix

`anon` has no public-table privileges. `service_role` is server-only and bypasses end-user RLS. Every browser request uses `authenticated` and is authorized by membership or explicit project access.

| Record | Team member | Client contact | Mutation/history rule |
|---|---|---|---|
| `projects` | Read/create/update within organization | No direct access | Archive; no authenticated delete |
| `clients` | Read/manage within organization | No direct access | Team-managed |
| `workstreams` | Manage within organization | No direct access | Client sees released projection only |
| `tasks` | Read/create/update within organization | None | Triggered lifecycle; archive, no delete |
| Workflow tables | Manage within organization | None | Version templates; archive template |
| `task_dependencies` | Manage within organization | None | Link may be deleted |
| `milestones` | Manage within organization | None | Client sees released projection only |
| `deliverables` | Manage within organization | None | Archive/withdraw; no delete |
| `deliverable_versions` | Manage within organization | None | Reviewed content is frozen; state machine enforced |
| `files` | Manage metadata within organization | None | Client download is later mediated by a signed server response |
| `approvals` | Read and append internal decisions | None while approvals disabled | No update/delete policy or grant |
| `requests` | Full team workflow | Read shared rows; insert controlled revision/client-work row | Client target version must already be released |
| `research_records` | Manage within organization | None | Client sees only a released summary projection |
| `comments` | Manage within organization | Read/create/edit own `client_shared` comments | No authenticated delete |
| `activity_events` | Read and append | None directly | Append-only |
| Living record | Read/update generated record; append snapshots | None directly | Client sees released projection only; snapshots append-only |
| Client projections | Manage/release/withdraw | Read only for explicitly assigned visible project | Sanitized fields only |

## Policy invariants

- All update policies include both `USING` and `WITH CHECK`.
- No policy uses deprecated `auth.role()`.
- `TO authenticated` is always combined with an organization, project-access, owner, or exact released-version predicate.
- Authorization helpers use a fixed empty `search_path`, reject anonymous callers, and expose only boolean answers.
- Newly created public tables receive explicit Data API grants and have RLS enabled.
- Client approval rows have no client insert policy; internal insert also rejects `approval_type = 'client_approval'` in this migration.
- Client release is a copied projection action, so internal columns cannot leak merely because a row becomes visible.
