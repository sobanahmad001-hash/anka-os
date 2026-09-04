# P3 Project Setup and Project Workspace Review Gate

## Review basis

- Canonical base: `origin/main` at `c0738e19a4e629f139bca09339074c3d39881092`.
- Existing authorities are preserved: Projects owns canonical project creation; Operating Spine and PLN own engagement composition and pipeline preview/instantiation.
- Active Content B02 is already contained by the canonical base. Active Design B02 changes only Design Workshop, creative-brief, Edge Function, and migration files; P3 has no overlap.
- The approved operating architecture keeps Client Work and Internal Work on one canonical spine, preserves optional one-to-one engagement extensions, and requires official isolated service work to retain real client, brand, and engagement identity.

## Delivered scope

P3 extends the existing read-only project workspace without adding a new creation transaction:

- project brief, engagement objective, scope, exclusions, client and brand context;
- project and engagement owners, active workstreams, milestones, progress and attention signals;
- active services, supplied existing assets, instantiated journey, prerequisites, and immutable pipeline-template provenance;
- honest delivery-shape presentation: official one-service work may be labelled isolated; multi-service work remains a connected selection because the schema does not record a full-versus-partial classification;
- separate Project Tasks and Engagement Work Items;
- separate generation, approval, client release, and completion evidence;
- explicit organization selection, loading, missing, denied, error, and stale-refresh states;
- responsive tab overflow plus Arrow, Home, and End keyboard navigation;
- unchanged Workshop links with original organization, client, project, engagement, brand, service, stage, record, and origin context.

## Authority and exclusions

P3 performs explicit organization-scoped `select` queries only. It adds no insert, update, delete, upsert, RPC, Edge Function, migration, schema, provider, config, scheduler, or live-system action.

Creation authority, transaction ownership, required fields, milestone defaults, post-start service changes, internal operating-service rules, and persisted full/partial labels remain policy decisions. P3 does not route around those decisions, change active services, or infer missing identity.

P4 and later packages, Management, Meetings, Sales, Finance, People, Workshop production tools, recurring-plan behavior, Quick Tasks, and release/deployment work remain excluded.

## Reviewer checks

1. Confirm HEAD, base, and merge-base all derive from the exact approved canonical base.
2. Confirm the diff contains only the P3 project workspace app, model, repository, tests, and this review gate.
3. Confirm every new query is constrained by the active organization and validated again in the read model.
4. Confirm clientless non-internal projects are not labelled Client Work.
5. Confirm an isolated-service label requires one active service plus a valid client, brand, and engagement.
6. Confirm multi-service work is not guessed to be full or partial.
7. Confirm Project Tasks and Engagement Work Items remain distinct.
8. Confirm generation, approval, release, and completion remain separate.
9. Confirm Workshop navigation retains its original record and workspace context.
10. Run focused tests during iteration, then one consolidated final Node, frozen Deno, lint, build, type-check, diff, and clean-state gate.

## Rollback

Revert the P3 commit. No database rollback or data repair is required because P3 is read-only and migration-free.
