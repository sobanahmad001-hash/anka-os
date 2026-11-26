-- Consent is immutable version metadata. Identical content must be able to
-- acquire explicit consent in a separately reviewed successor version.
-- Keep content hashes unchanged and retain duplicate protection per consent state.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table public.artifact_versions
  drop constraint artifact_versions_artifact_id_content_checksum_key,
  add constraint artifact_versions_content_consent_key
    unique (artifact_id, content_checksum, ai_use_allowed);
