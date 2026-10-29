# Anka Staging Receiver 1.0.1

This receiver provides authenticated, immutable WordPress core-block previews on an isolated staging site. It does not activate themes, replace WordPress pages, approve delivery or publish to a client. W3 packages and canonical Anka page/build history remain the source of truth.

## Operator setup

1. Use a dedicated HTTPS staging WordPress 7.1.3 or 7.1.4 / PHP 8.3 installation at an origin root. No URL credentials, redirects, alternate ports, IP literals or private-network destinations are accepted by Anka. Do not install or enable this receiver on a client production site.
2. Set `WP_ENVIRONMENT_TYPE` to `staging` in that installation’s normal configuration. Set `ANKA_STAGING_SITE_ID` to an operator-generated UUID. Keep this identity stable for the site; changing it requires a new reviewed Anka binding.
3. Install and activate the reviewed plugin using normal authorized WordPress access. Activation creates the `anka_staging_agent` role with `read` and `anka_stage_packages`; it assigns no users. Assign a dedicated account that role and create a revocable WordPress Application Password through normal account administration.
4. Configure the existing Anka WordPress connection using its server-side `ANKA_WORDPRESS_*` credential reference. Keep the application password out of chat, drafts, browser receipts and source files. Verify the connection, grant Development access and explicitly link it to the intended project using the existing connection controls.
5. Through normal authorized server configuration, set `WEBSITE_STAGING_ALLOWED_ORIGINS` to a JSON array containing the exact staging origin, for example `["https://staging.example.test"]`. This example is not a real connection. An absent or empty list disables all dispatch. Do not change paid-execution settings.
6. In the project’s existing Development workspace, an organization owner or operations admin selects the connection, inspects the live identity and explicitly confirms/binds that exact isolated site. Ordinary Development authority cannot create a target binding.

## Manual staging and revisions

Canonical page keys are retained independently of the approved URL path; staging route indexes never replace another registered page. Select the bound site and an exact completed native package, then run **Dry run staging**. Review the actual site identity, package checksum and current remote page head before **Deploy reviewed staging preview**. Anka rechecks current authority, active implementation service, connection revision, source versions and the remote head. Only this explicit action sends a package to the receiver.

The receiver validates the fixed nine-file compiler manifest, file checksums, trusted PHP adapter hash and bounded core-block markup. It never executes uploaded PHP, accepts arbitrary ZIPs or fetches remote resources. Package data is kept in non-autoloaded private WordPress options. One database compare-and-swap appends the page’s retained request history; conflicting remote heads fail closed. A replay returns its original receipt and does not deploy again. Each page retains up to 500 staging revisions; reaching that bound stops further revisions without deleting history.

Preview URLs require a WordPress login with the dedicated capability. They carry no password or bearer token and return private/no-store, noindex and restrictive CSP headers. The renderer uses WordPress core blocks and the exact package styles; the active theme and WordPress page records are unchanged. Links to another staged page are pinned to its version when this preview is created. Unstaged paths are reported explicitly. Review a new revision to refresh link bindings; old previews are not rewritten.

Use **Recover original staging request** after an uncertain response. It reads the remote original and verifies its preview without another deployment POST. It may append the recovered receipt in Anka. A missing remote receipt stays uncertain; elapsed time alone never proves that a remote deployment failed. A live worker may close a failed preflight only when it knows that it never attempted the deployment POST. Hard worker loss requires recovery or normal operator investigation; no replacement request is sent automatically. Absence of a local claim is reported as a read-only observation; no deployment is resent. An existing unsettled attempt blocks new attempts for that page/target.

Add explicit page issue notes and append explicit resolutions. These do not edit designs, start AI, create assignments or complete Work. For a source change, use the existing Website Design editor, save/build a new version, select its package manually and select the retained staged predecessor. A supplied predecessor must match the current remote page head. Previous source, previews and issue events remain retained.

## Separate gates and evidence

Client-site publication is unavailable in this protocol. W5 requires its own exact-target publication approval, complete QA and rollback evidence. Functional forms, property databases and search remain separately modelled work.

The portable `tools/check-website-staging-wordpress.mjs` harness exercises the receiver on pinned local WordPress 7.1.3/PHP 8.3 with networking disabled and synthetic local accounts. Native PostgreSQL and mocked Anka/browser tests verify their own bounded layers. None of these establish a signed-in production Anka write or a real staging-site deployment. Live acceptance requires a normally configured, authorized connection and its exact real target.

Receiver 1.0.1 explicitly supports reviewed WordPress 7.1.3 and 7.1.4 only, with PHP 8.3 patches. Other WordPress versions and PHP minor versions remain denied. Both the receiver permission guard and Anka identity validator enforce this list. The local harness accepts optional WordPress version and isolated port arguments after the browser path; its default remains 7.1.3.
