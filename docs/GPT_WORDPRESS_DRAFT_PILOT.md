# GPT editable WordPress staging candidate

Status: local candidate, disabled by default. No hosted installation, permission change,
page write, publication or new credential was performed during development.

The existing broker gains `wordpress_read_draft` and `wordpress_save_draft` only when
all staging settings are present. Upstream OAuth credentials remain inside the broker.
A new SQL RPC checks current OAuth/session/project/card authority, a separately granted
actor/client/card/target permission with expiry, and the verified staging connection.
Existing Work-save consent does not grant external writes.

The receiver accepts a fixed project scope and native editable core blocks. It binds
one page to each canonical card, adopts explicitly configured existing drafts, and
requires the exact current version on updates. A null version creates only an unbound
card's page; it cannot replace the adopted pilot. The receiver locks the card and page,
then commits the draft, native revision, binding and request receipt together in
InnoDB. Same-request retries return the historical receipt without rewriting a later
human edit. Unknown outcomes must retain every original argument.

After a verified receiver receipt, the broker records a canonical Work content draft
with the same request UUID. Work response loss retries the same save and cannot add
another version. A failed or revoked audit step leaves the remote receipt recoverable;
the operation is not reported complete until both receipts verify. A person can still
edit WordPress after this operation; future writes must reread its version.

## Exact pilot activation scope

- Origin: `https://ankaos.ankasphere.com`
- Site identity: `e9ef5fd7-6418-487f-aea4-2bae4725684a`
- Existing target: `fd899c1e-9741-4534-8535-e49b9ffa80a4`
- Organization: `8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25`
- Project: `658d604f-3c5b-404d-8b0e-25c8096bdf10`
- Card kind: `engagement_work_item`
- Card: `ef31334b-c334-4ede-9a62-62bd17d66721`
- Adopt existing page **3156**. Never create a replacement pilot page.
- Editor: https://ankaos.ankasphere.com/wp-admin/post.php?post=3156&action=edit
- Preview: use the signed-in editor's Preview action; the earlier manually constructed
  `?page_id=3156&preview=true` link did not work and is not accepted preview evidence.

Install-time constants (no secrets):

```php
define('ANKA_DRAFT_SCOPE', [
  'organization_id' => '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25',
  'project_id' => '658d604f-3c5b-404d-8b0e-25c8096bdf10',
  'site_id' => 'e9ef5fd7-6418-487f-aea4-2bae4725684a',
]);
define('ANKA_DRAFT_ADOPTIONS', [
  '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25:658d604f-3c5b-404d-8b0e-25c8096bdf10:engagement_work_item:ef31334b-c334-4ede-9a62-62bd17d66721' => 3156,
]);
```

## Required hosted setup and remaining acceptance

1. Review/merge the candidate and pass CI. Install the exact migration
   `20261127142408_hybrid_wordpress_draft_scope.sql`. It grants no user access by itself.
2. Verify staging origin/site identity, current WordPress/PHP versions, InnoDB tables,
   native page 3156 draft status and existing block content. Back up that exact draft.
   Install `wordpress/anka-drafts/anka-drafts.php` on staging only, with the constants
   above and `WP_ENVIRONMENT_TYPE=staging`. Keep Hello Elementor and page metadata.
3. A staging administrator must provision a dedicated user with only `read` and
   `anka_edit_staging_drafts`, and an application password. No `edit_pages`,
   `publish_pages`, administrator, plugin/theme or live-site permissions are needed.
   Store it through Railway's secret configuration, never chat, source or Work notes.
4. Configure existing broker service with `BROKER_WORDPRESS_ORIGIN`,
   `BROKER_WORDPRESS_SITE_ID`, `BROKER_WORDPRESS_USER`, `BROKER_WORDPRESS_PASSWORD`.
   Do not reuse an administrator credential or change the other Railway projects.
5. Insert one reviewed, expiring `private.hybrid_wordpress_grants` row for the founder's
   current OAuth client and this exact card/target. Confirm current canonical access
   and refresh a stale connection binding through its normal supported flow.
6. Before real writes, verify HTTPS application-password authentication and denials
   against the installed receiver. Local tests invoked the actual WordPress handler
   with a synthetic authenticated actor, not a full hosted HTTP login flow.
7. Use the connector to read/adopt page 3156, then save only the owner-requested
   Concept B content after native-block conversion and source review. Reopen the
   actual authenticated preview, retry the identical request, and independently
   verify one receiver receipt, one intended native revision and one Work record.
   Capture desktop/mobile screenshots before claiming visual parity.

Activation adds a new external-write permission and a dedicated server-held WordPress
credential. These exact hosted changes require a release/setup decision; the candidate
does not activate them automatically. Removing the broker staging settings hides both
tools; revoking the card grant or application password denies future use. Retain draft,
receipts and Work history when disabling. No live-site publication path exists here.

## Design references, not execution evidence

Founder selected Anka Sphere Homepage 4.0 Concept B:
- Desktop: https://www.figma.com/design/FRNjqyjwo1XGaMgU3TJoC9/?node-id=1-230
- Mobile: https://www.figma.com/design/FRNjqyjwo1XGaMgU3TJoC9/?node-id=1-435

These references have not yet been converted or visually verified by this candidate.
The earlier local `index.html` pilot is not evidence of Concept B parity. Record both
Figma references with the actual saved revision and authenticated preview on the same
Work card after successful save/reopen. No founder-requested copy change was invented.

The receiver currently supports static core group/columns/heading/paragraph/buttons/
separator/spacer/list blocks. It rejects HTML, scripts, embeds and dynamic blocks.
If Concept B requires an unsupported block or asset, report the specific requirement;
do not silently flatten it or claim visual equivalence. Page-template/theme changes,
image uploads and publication are outside this candidate.

## Validation on 2026-11-27

- 12 Python broker/configuration/recovery tests passed using the existing local pinned
  dependency image. Includes hidden-by-default tools, revoked access, response loss,
  changed-payload conflict, same Work receipt and historical retry preservation.
- 18 real WordPress/MariaDB checks passed: WordPress 7.1.5, PHP 8.3.37; adopted synthetic
  page 3156, native block preservation, real revisions, create-once, stale-write denial,
  same-request replay without an extra revision, unsafe-block denial, rollback after
  injected post-write failure, and cookie-only access denial. Runtime images pinned
  by digest in the runner; no host ports, production data or hosted credentials.
- 9 actual SQL migration/grant checks passed in the existing disposable Supabase
  fixture, all rolled back. Includes no implicit grant, exact target, foreign project,
  revoked/expired grant, read-only/revoked OAuth, disabled connection and private grants.
- PHP syntax check and `git diff --check` passed. Hosted CI has not run yet.

References: [WordPress application-password identity](https://developer.wordpress.org/reference/functions/rest_get_authenticated_app_password/)
and [native revision API](https://developer.wordpress.org/reference/functions/wp_save_post_revision/).
