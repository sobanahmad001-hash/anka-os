# RET2 Manual Period Generation Review Gate

## Scope

RET2 adds deliberate preview-and-confirm generation for one recurring plan period. It creates
canonical `work_items` atomically from one approved immutable plan version and records
append-only occurrence and request provenance.

It does not add retainer planning UI, scheduled generation, Cron, notifications, bulk catch-up,
occurrence acceptance, client visibility, or `tasks`/`work_items` convergence.

## Approved behavior

- Weekly periods are anchored to the applicable version's `effective_start` and repeat every
  seven plan-local dates.
- Monthly periods preserve the anchor day. Missing days clamp to month-end without drift.
- Windows are half-open `[period_start, period_end)`; `effective_end` is inclusive when
  selecting the most recently approved applicable version.
- The frozen version timezone is authoritative and remains an IANA name validated by RET1.
- RET2 has no scheduled local clock. Manual confirmation stores its real `generated_at`
  `timestamptz`, plus frozen timezone and version provenance. DST gap/fold conversion remains
  mandatory for RET4 if a local scheduled clock is introduced.
- Only the current Service Owner may preview or confirm.
- Plan, retainer engagement, activated engagement service, catalogue service, and template
  assignees must all be active. There is no override.
- A past period requires a bounded reason. There is no automatic or bulk catch-up.
- Occurrence identity is `(organization_id, plan_id, period_start)`, independent of version or
  request key. Generated work identity is `(occurrence_id, template_key)`.
- Confirmations serialize by organization/plan/period. The same request returns the existing
  IDs; a new request for the same period records a replay and returns the same IDs.
- A request key reused for another business period is rejected.
- `created_via = 'recurring_plan'`; operational events remain in `engagement_events`.
- Occurrences, attempts, and work-item creation provenance are append-only.

## Security and data checks

- [ ] Both RET2 tables have authenticated, active-team organization SELECT policies only.
- [ ] Browser roles cannot insert, update, or delete RET2 rows or execute either RPC.
- [ ] Service role has only required table and RPC privileges.
- [ ] All plan/version/engagement/service/occurrence relationships use tenant-composite FKs with
  supporting indexes.
- [ ] Organization is derived from the selected plan; no browser-selected active organization is
  trusted for authorization.
- [ ] Preview performs no writes and returns exact template dates and ineligibility reasons.
- [ ] Confirm creates one occurrence and a complete canonical work-item batch in one transaction.
- [ ] Sequential and distinct-key replays return one occurrence and the identical item IDs.
- [ ] Advisory serialization plus database uniqueness closes concurrent duplicate creation.
- [ ] Injected failure on a later work item leaves no occurrence, attempt, item, or audit residue.
- [ ] Existing manual, chat-proposal, automation, and RP3 work-item paths remain unchanged.

## Verification

- Migration: `20260903123259_ret2_manual_period_generation.sql`
- Rollback verifier: `verify_20260903123259_ret2_manual_period_generation.sql`
- Focused contracts:
  - `src/data/recurringPlans.test.js`
  - `supabase/functions/recurring-plans/index.test.ts`
- Required gates:
  - [ ] Full Node tests
  - [ ] Full frozen Deno tests and type-check
  - [ ] Lint with zero errors
  - [ ] Production build
  - [ ] PostgreSQL migration execution and all named rollback checks
  - [ ] `git diff --check`
  - [ ] Exact-head CI

## Release boundary

This PR may be reviewed and tested only. Admin/Testing retains authority for merge, production
migration, deployment, and any live verification. No schedule may be created by this phase.
