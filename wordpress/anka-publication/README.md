# Anka publication receiver

This receiver is separate from private staging. Installing its source does not authorize a client-site publication. Production connection, exact site identity, project binding, saved page QA, separate delivery approval, and unchecked live-operation confirmation remain required.

## Supported target

- Single-site WordPress 7.1.3, PHP 8.3, and transactional InnoDB WordPress tables. SQLite is supported by the isolated test runtime.
- Receiver version 1.0.0; older inspection-only code cannot satisfy the current identity check.
- Explicit production environment, `ANKA_PUBLICATION_ENABLED === true`, and a separately reviewed UUID `ANKA_PUBLICATION_SITE_ID`.
- Dedicated `anka_publish_packages` capability. Activation creates a role but assigns no users and changes no existing roles.
- The normal backend credential reference and the separate `WEBSITE_PUBLICATION_ALLOWED_ORIGINS` allowlist. No credential values belong in source, commands, receipts, or chat.
- Exact local canonical permalinks. Unpublished posts need an explicit slug; inspection does not publish them. WordPress system routes are rejected as destinations.

The owner reviews each create or exact replacement, the selected package/QA/approval versions, and the complete site-wide theme impact. New front-page creation is deliberately unavailable until a separate site-settings review is modelled; an inspected existing front page can be explicitly replaced. Custom templates and theme modifications that prevent the exact compiled theme fingerprint are not silently removed or converted.

## Execution and recovery

The fixed compiler produces six known theme files. Only a new exclusively created inactive directory can receive them. No supplied archive, arbitrary PHP, path, or theme code executes. The original page rows, managed metadata, theme selectors/modifications, site settings, and inventory checksum are retained privately before crossing execution.

All page/metadata changes, theme activation, terminal journal, head transition, and original lock release use one database transaction. The theme-switch lifecycle finishes before verification; hard rewrite-file updates are disabled. Originals and prior revisions are retained. The receiver never changes front-page settings, assigns Work, approves content, or calls an AI provider.

Interrupted execution remains uncertain, even when the transaction rolled back. Original requests are not resent or expired into permission to retry. GET recovery returns bounded receipts and opaque inventory/backup references, never original bodies or credentials. An exact terminal replay cannot release a newer request's lock.

Rollback requires the original successful publication, exact retained backup, unchanged selected page rows/revisions, unchanged published head/theme, and explicit complete theme-impact review. It restores original replacement content/status and the three managed metadata fields. Newly created pages move to recoverable trash; posts, revisions, theme files, and backups are never deleted. A later edit or changed retained original theme denies rollback.

Anka records the verified outcome independently from canonical registry projection. Page revisions append only while the reviewed canonical head still matches; a later manual operation produces an explicit projection conflict rather than being overwritten. Historical package, approval, Work, and publication records remain intact.

## Local verification boundaries

The isolated WordPress/PHP runtime exercises actual page writes, revisions, theme activation, REST receipts, failure rollback and original-backup restoration. Native PostgreSQL tests exercise the actual scoped journal and registry writers on synthetic base records. Desktop/mobile and keyboard journeys use synthetic app repositories. These checks do not establish signed-in production or real-client acceptance. A native InnoDB WordPress deployment has not been exercised in this workspace; its target acceptance remains separate before any real client execution.
