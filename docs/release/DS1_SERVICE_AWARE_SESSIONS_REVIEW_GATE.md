# DS1 Service-Aware Sessions review gate

## Schema and security

- [ ] `design_workshop_sessions.engagement_service_id` is nullable for historical rows and references `(engagement_services.id, organization_id)`.
- [ ] No historical session is backfilled or guessed.
- [ ] `output_family` remains present and unchanged for backward-compatible display.
- [ ] `design_directions.direction_slot` accepts 1 through 12 and rejects 13.
- [ ] Existing session and direction RLS policies remain enabled and unchanged.

## Server and UI behavior

- [ ] New sessions require an active `engagement_services` row belonging to the selected engagement.
- [ ] The selected service must resolve to an active Design `service_catalog` record.
- [ ] The UI lists only the engagement's active Design services and no longer offers a free-standing output-family picker.
- [ ] `output_family` is derived server-side from the selected service and is never trusted from browser input.
- [ ] All eight Design services continue through the existing three-direction compare/release flow.
- [ ] `brand_visual_identity` and `campaign_creative` retain the same three-direction behavior.

## Scope and release hold

- [ ] No variant generation, multi-page flow, storyboard sequence, design-system library, production handoff, or generation/model change was added.
- [ ] Review the migration, rollback verifier, Edge Function, repository, UI, and both Node/Deno tests directly.
- [ ] Do not run the verifier against production without explicit approval.
- [ ] Do not merge, apply the migration, deploy the function, or release the frontend before explicit approval.
