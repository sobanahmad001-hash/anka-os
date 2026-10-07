import { validateContentArtifact, assertWebsitePageIdentityTransition } from './contentArtifacts.ts'
import { projectWebsiteImportDraft } from './projectSpreadsheetDraft.mjs'
import { requireProjectImportSource } from './projectSpreadsheetAdapters.ts'

// Draft preparation only. Future transactional proposal confirmation must recheck
// current authority/version and store the receipt in the private Chat proposal.
// Never pass a browser-created preview here; reconstruct from verified bytes.
export function prepareProjectWebsiteImportDraft(input: Parameters<typeof projectWebsiteImportDraft>[0]) {
  requireProjectImportSource(input, 'website_pages')
  const draft = projectWebsiteImportDraft(input)
  const content = validateContentArtifact(draft.artifactType, draft.content)
  if (input.latestVersion) assertWebsitePageIdentityTransition(input.latestVersion.content, content.pages)
  return { ...draft, content }
}
