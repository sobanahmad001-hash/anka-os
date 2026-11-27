# Approved positioning through ChatGPT

`project_get_context` includes `positioning` only for an explicitly selected shared artifact version. The private selection pins project, organization, artifact, version, approval and checksum. Every read rechecks the current OAuth project grant/session, project membership, active engagement, exact approval and `ai_use_allowed`. Selection does not approve content or grant AI consent.

Only the selected body (at most 12,000 characters), bounded HTTP(S) citation strings and exact approval/version provenance are returned. Other content keys, other artifact bodies and private conversations remain excluded. Missing or mismatched evidence returns null with `approved_positioning_unavailable`. Newer versions never silently replace the selected version. The reference does not establish engagement scope or approve generated briefs.

The initial owner-authorized selection is Anka Sphere's published positioning reference v2, `ed5c18ab-53e5-4f84-baa3-108bce1aeb94`, approval `088e521d-1981-4093-9e91-a84fce189032`. V1 has no AI consent and remains excluded. Other projects receive no selection automatically. A future source change requires an explicit reviewed selection of its own approved, AI-enabled version.

The broker invokes the SQL context RPC, so no broker credential, OAuth scope, API grant or Railway redeployment changes are needed. Existing JavaScript authenticated-context adapters remain metadata-only.

Disposable integration regression:

```text
node tools/test-hybrid-positioning.mjs <existing-local-broker-fixture.json>
```

The runner refuses non-loopback fixtures and checks the disposable Docker project label/port. Migration and synthetic data are tested inside one transaction and rolled back. It checks exact approved text, a later unapproved version, AI-disabled v1, wrong-version approval, checksum mismatch, non-text citation exclusion, private-field omission, cross-project denial, revoked consent, and absence of direct table/helper privileges. Never use production credentials or data as a fixture.
