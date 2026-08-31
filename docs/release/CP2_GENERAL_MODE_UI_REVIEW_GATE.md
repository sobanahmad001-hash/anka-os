# CP2 General Mode UI — Review Gate

## Accepted foundation

CP2 reuses the live CP1 `content_requests` model and its existing server mutation. General requests continue to use `mode = 'general'`, a null `engagement_id`, and an optional `brand_id`.

## Included

- A prominent “Make a post / reel” entry point in Content Studio.
- A short general-request form requiring only a brief, format, and output path.
- Optional brand selection from brands visible through existing organization RLS.
- A flat, newest-first General Requests list that is available without an engagement workspace.
- The existing `content-studio` `create_content_request` action and CP1 database function.

## Explicitly absent

- No migration or RLS change.
- No second `content_requests` insert path.
- No general-mode internal media generation.
- No Figma reference-page generation.
- No recurring queue, calendar, folder, or category system.

## Verification required before merge

1. Run the full Node test suite.
2. Run the Content Studio Deno tests and type-check the unchanged server handler.
3. Run ESLint with zero errors and the production build.
4. Confirm the PR diff contains no file under `supabase/migrations`.
5. Confirm General Requests renders before the engagement loading/empty-state gate.
6. Confirm both branded and unbranded submissions call the same CP1 action.

No merge or production deployment is authorized by this implementation PR.
