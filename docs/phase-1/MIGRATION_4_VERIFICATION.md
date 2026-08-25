# Migration 4 Live Verification

Project: `fhoxaogfjszftoqtnbav`
Migration: `20260825040000_canonical_delivery_core`
Verified: 2026-08-25

## Passed checks

- All 16 canonical tables exist.
- RLS is enabled on all 16 canonical tables.
- Task transition trigger exists.
- Deliverable-version transition trigger exists.
- Automatic Living Project Record trigger exists.
- Anonymous public-table grants: `0`
- Elevated authenticated grants: `0`
- Canonical foreign keys to legacy `as_*` tables: `0`
- Client approval insert policies: `0`
- Client approvals enabled: `false`
- Zero projects correctly correspond to zero living documents after the test-data reset.

## Follow-up finding

`legacy_broad_policy_count` returned `1`. Repository inspection identified the duplicate policy name `Authenticated users can read comments` on the retired `review_comments` table. This table and its parent `design_reviews` are unused by active React code and superseded by canonical deliverables, versions, approvals, and comments.

Migration 5 closed all browser-role access to those two retired tables and has now passed live verification. Migration 4 is fully accepted as the canonical delivery-core deployment.
