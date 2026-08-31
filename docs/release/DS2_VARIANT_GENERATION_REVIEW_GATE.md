# DS2 Variant Generation review gate

## Platform format decision

- `square_1x1` — 1080×1080 social square.
- `portrait_4x5` — 1080×1350 social portrait.
- `story_9x16` — 1080×1920 Stories/Reels vertical.
- `landscape_1_91x1` — 1200×628 social/responsive-display landscape.
- `banner_728x90` — Google Display leaderboard.
- `banner_300x250` — Google Display medium rectangle.
- The brief's provisional `landscape_16x9` image format was replaced with `landscape_1_91x1`. Current image guidance uses 1.91:1; 16:9 is primarily a video shape.

First-party references checked before implementation:

- Meta Reels guidance: https://www.facebook.com/business/ads/facebook-instagram-reels-ads
- Google uploaded Display sizes: https://support.google.com/google-ads/answer/1722096
- Google responsive Display image ratios: https://support.google.com/google-ads/answer/17090561
- Google Demand Gen asset specifications: https://support.google.com/google-ads/answer/13704860
- OpenAI GPT Image generation sizes: https://developers.openai.com/api/docs/models/gpt-image-2

GPT Image accepts square, portrait, and landscape provider canvases rather than arbitrary pixel dimensions. DS2 selects the closest supported provider canvas, then center-crops/resamples the generated image and exports a PNG at the exact declared platform dimensions. The PNG header is checked before upload; a variant cannot become `ready` unless its binary dimensions match its format.

## Schema and security

- [ ] `design_direction_variants` is the only new table.
- [ ] Both foreign keys include `organization_id` and their referencing columns are indexed.
- [ ] RLS uses `is_team_organization_member(organization_id)` and browser roles remain read-only.
- [ ] The database trigger rejects unreleased sources, non-Social/Advertising sessions, and media from another direction version.
- [ ] The migration contains no fixtures or seeded rows.

## Server behavior

- [ ] `generate_variants` accepts only released `social_assets` or `advertising_assets` direction versions.
- [ ] The existing `generateOpenAiImage`, `design_media_assets`, private bucket, storage path, and signed-URL path are reused.
- [ ] `generateImageForTarget` is the only asset-generation helper for direction, content-request, and variant images; the CP1 request body remains unchanged when no provider size is supplied.
- [ ] Every variant is crop/resampled to its declared dimensions and its exported PNG dimensions are verified before upload and `ready` status.
- [ ] Multiple selected formats are processed independently; one failure does not stop later siblings.
- [ ] Every requested format creates its own status row.
- [ ] Existing single-image and video-placeholder behavior remains unchanged.

## UI and scope

- [ ] Variants appear in a dedicated released-format panel, outside the direction comparison grid.
- [ ] Users choose formats explicitly; the application does not infer a platform.
- [ ] Draft, selected-but-unreleased, and non-target service sessions show no variant-generation UI.
- [ ] No multi-page flow, storyboard, design-system library, production handoff, or independent variant editing was added.

## Release hold

- [ ] Review migration, rollback verifier, Edge Function, repository, UI, and Node/Deno tests directly.
- [ ] Do not apply the migration, run the live verifier, deploy, merge, or release before explicit approval.
