# Workspace P6 Retainer Operations audit

Baseline: exact production main `ef17314cea7fa0af5d8613d3a25617df1eaa5959`.

## Classification

Implement now independently, limited to RET-owned presentation-model, component, test, and review-gate files. The baseline already contains RET1 plan/version/approval, RET2 manual period generation, RET3 monthly preview/planning, RET4 opt-in scheduler backend, and RET5 read-only review.

No new schema is required for the P6 operations distinction. A future schema change remains blocked until the coordinator assigns migration ordering.

## Operational categories

- Commitments are template definitions belonging to approved plan versions that govern the selected month. They are not work records.
- Projections are ungenerated canonical period starts computed from those approved versions. They have no occurrence or work identity and grant no generation authority.
- Generated work is canonical work linked through a recorded recurring occurrence and frozen plan-version provenance.
- Carryover is earlier-period generated work whose current status remains `not_started`, `in_progress`, or `blocked`. P6 never moves its dates or period.
- Currently completed work is selected-month generated work whose current status is `done`. P6 does not infer a historical completion timestamp.

The legacy combined `upcoming` model remains available for compatibility, while P6 exposes explicit `commitments`, `projections`, `generatedStarts`, and `generatedWork` collections.

## Ownership and exclusions

P6 changes only `src/data/retainerReview.js`, its RET test, `src/components/RetainerReviewPanel.jsx`, and this gate. It does not edit App/shared navigation/layout, P4 My Work or item detail, P5 planning components, P7 review/deliverable shared code, P8 records/activity code, canonical work-item definitions, or any migration.

Scheduler activation, Cron/provider actions, deployment, live SQL, push, merge, and automatic catch-up remain excluded. Existing RET4 files and runtime configuration are unchanged.

## Verification

- Existing RET1–RET5 and repository data/contract tests must remain green.
- P6 tests must prove generated starts cannot also appear as projections.
- Approved commitments, projections, generated work, carryover, and completed work must remain separately countable.
- Repository reads remain caller-RLS scoped and mutation-free.
