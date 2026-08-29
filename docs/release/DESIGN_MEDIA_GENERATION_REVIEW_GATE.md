# Design Workshop Media Generation — review gate

## Scope delivered

- Live still-image generation extends the existing Design Workshop and its model registry.
- Each attempt is attached to one exact immutable `design_direction_version`.
- Generated PNG files are stored in the private `design-generated-media` bucket.
- Ready files are served only through server-created links that expire after five minutes.
- Multiple attempts are retained; failed attempts remain visible and are never overwritten.
- The visible video action creates an `unavailable` audit row and makes no provider request.

## Security and visibility

- Browser roles have no object-level access policy for the private bucket.
- The Edge Function checks the requested direction version through the signed-in user's RLS client before any privileged write or signing operation.
- Media reads inherit the exact direction-version policy, including private D2 experiment creator/invitee visibility.
- The service credential and provider credential never enter the browser.

## Model routing

- `gpt-image-2` is registered with only the `image` output capability.
- Existing direction sessions accept only models with the `design_direction` capability.
- The image request uses the selected registry row's `model_id`; no image model is hard-coded in the provider request.

## Known gap

Rate limits, quotas, and cost caps are intentionally not part of this phase. Before broad production access, add organization and engagement generation budgets plus request throttling.

## Publish-time checks (not run by this review PR)

1. Apply `20260829113811_design_media_generation.sql` and run its verification script.
2. Deploy the updated `design-workshop` Edge Function, then the frontend.
3. Confirm a real image request reaches `ready`, the object is private, and the signed URL expires.
4. Confirm a provider failure creates a visible `failed` attempt with no object.
5. Confirm a D2 experimental version and its media are invisible to a non-invitee.
6. Confirm Generate video returns the exact unavailable message and produces no outbound video request.

Do not merge or deploy this phase until the review gate is approved.
