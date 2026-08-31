# RP4 HTML/CSS page designs — review gate

Nothing in this phase is deployed or merged by opening its PR.

## Reviewer checks

- Confirm the branch starts from `d9947a9` or a later reviewed `main` commit.
- Confirm `website_architecture.pages[]` is read with `{ slug, title, parent_slug, page_type, purpose }`; `page_slug` must not be introduced.
- Confirm the `content` artifact is matched through `pages[].page_path`, with `meta_title` and `meta_description` used when present and explicit placeholders otherwise.
- Confirm each generation inserts a new `website_page_designs` row attached to one exact `design_direction_version_id`.
- Confirm the browser can only read page designs through RLS; all generation and review writes stay server-side.
- Confirm private D2 direction visibility is inherited by the page design select policy.
- Confirm the preview uses a sandboxed iframe and the stored HTML/CSS, rather than a mock card.
- Confirm only `draft -> in_review -> approved` is implemented. RP4 must not export, convert, deploy, or write the RP5 fields.
- Confirm PR39 image reuse uses private-bucket signed URLs and does not generate duplicate images.

## Live database gate

The migration and `supabase/verify_20260831110424_rp4_html_css_page_designs.sql` require separate explicit production approval. Before a verification run, confirm the script ends in `rollback;`. Report every named boolean check and stop if any result is `false`.
