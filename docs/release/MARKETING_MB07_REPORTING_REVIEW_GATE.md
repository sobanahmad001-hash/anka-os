# Marketing MB07 reporting review gate

## Candidate scope

- Base commit: `e0b7bc78036467907c1557348704d5abf7c79a39`
- Branch: `feat/marketing-mb07-reporting-20260913`
- Delivery: local review candidate only; no deployment, publication, provider write, or live environment mutation
- Preserved accepted Marketing MB05 commit: `fb82358a5a495ce60362162c48bf6ecfa13898df`

## Contract mapping

- Retain the canonical `marketing_report` artifact, immutable `artifact_versions`, and existing exact-version approval records.
- Extend Marketing Studio with a dedicated Reports tab, explicit stored-source notes, exact-version selection and preview, and visibly labeled local text export.
- Retain the two-approver minimum for reports. The one-approver exception remains limited to `campaign_brief`.
- Add no report store, snapshot store, schema, policy, provider integration, delivery route, or publication path.

## Implemented boundary

- A new report save creates a new unapproved immutable version through the existing artifact save contract.
- Editors enter a title, exact reporting dates, explicitly named stored sources or evidence versions, executive summary, insights, and recommended actions.
- Saved report and version selectors keep review and export tied to one persisted version.
- Draft exports are labeled `DRAFT - NOT APPROVED`; approved exports identify only the selected approved version.
- Export is a local text download. It cannot approve, release, publish, refresh providers, or share the report.
- The generic artifact editor no longer offers `marketing_report`, preventing the old direct single-approval path from bypassing the report review panel.

## Verification

- Focused MB07 data and contract suite: 10 passed, 0 failed.
- Full Node test suite: 953 passed, 0 failed.
- Production build: passed (Vite 6.4.3, 462 modules).
- Focused lint: no errors. Remaining warnings in `MarketingStudio.jsx` pre-date this candidate and are unchanged JSX/no-unused-variable false positives.
- Supabase changelog relevance check: no platform change was required for this local reuse of the existing artifact/version/approval contracts.

## Product Design correction

- An explicit unavailable report or version now fails closed instead of silently selecting the latest record. An empty initial selection may still choose the documented first report and latest version.
- The exact output pointer is retained when the generic artifact route directs a report into the dedicated Reports tab.
- Same-scope authoritative refreshes preserve unsaved editor state. Deliberate report, version, tab, or context changes require discard confirmation; denied or changed scope clears the old editor content.
- An uncertain save response creates a checksum-only lock before the write begins. The lock survives component unmount and browser-session reload, disables repeated submission, and clears only when one new authoritative version has the exact server-normalized checksum or when a successful response identifies the exact saved version.
- Successful saves select the returned artifact and version IDs explicitly rather than falling back to the first or latest record.
- Late review callbacks are ignored after the active exact version or authorized scope changes.
- Permanent unit and mounted correction suite: 14 passed, 0 failed. The production build passes and focused lint remains at 0 errors with the same 27 pre-existing Marketing Studio warnings.
- Product Design's original sequential harness now validates fail-closed selection, dirty refresh preservation, and repeated-write blocking. Its final success scenario intentionally remains blocked because the prior scenario leaves an unresolved save in the same scope and its mocked returned version still contains the old content rather than the submitted revision. The permanent suite isolates a response that matches the submitted tenant, artifact, and checksum, and separately proves lock persistence and authoritative reconciliation.

## Evidence and decision gates

- The deployed report content validator preserves only `sources`, `period_start`, `period_end`, `executive_summary`, `insights`, and `recommended_actions`; this candidate deliberately stays within that contract.
- Current persisted report content does not pin metric rows, metric definitions, filters, retrieval timestamps, or unavailable-value notes. Therefore this candidate does **not** claim snapshot capture, snapshot refresh, metric freshness, or reproducibility.
- Saved source entries are explicit human-readable references, not enforced foreign-key links to evidence versions.
- Existing report saves do not expose a stable client write-request identifier. The UI prevents concurrent clicks, but lost-response retry deduplication remains a server-contract gate.
- Audience, optional commentary, and optional recommendation fields require a separate content-contract decision because the current validator discards unknown fields and requires all current narrative fields.
- Report release, client visibility, delivery scheduling, and final-format export remain outside this candidate and must continue through the existing approved exact-version delivery path.
- Signed-in acceptance and authorization checks against a configured Supabase environment remain required before release.
- The source brief was structurally inspected. Visual DOCX rendering could not be completed because LibreOffice is unavailable in the local workspace runtime.

## Review result

This candidate is ready for Product Design and Testing review as a bounded exact-version report authoring and review surface. It is not evidence for metric snapshotting, provider freshness, release, or publication.
