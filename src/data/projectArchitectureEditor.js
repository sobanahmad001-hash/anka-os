import { appendWorkshopNavigation, parseWorkshopNavigation, WORKSHOP_DESTINATIONS } from './workshopNavigation.js'

export function architectureReviewLink(workspace) {
  const roots = workspace.workshopArtifacts.filter(row => row.artifact_type === 'website_architecture')
  const workshop = workspace.workshopLinks.find(row => row.department === 'content')
  if (roots.length !== 1 || !workshop) return null
  const root = roots[0]
  const version = currentArchitectureVersion(root.versions)
  if (!version?.id) return null
  const context = parseWorkshopNavigation(new URL(workshop.path, 'https://anka.invalid').searchParams)
  const path = appendWorkshopNavigation(WORKSHOP_DESTINATIONS.content, {
    ...context, origin: '/sphere/workspace/projects/' + workspace.project.id + '?tab=discussion',
    originTab: 'discussion', workshopTab: 'artifacts',
  }, { architecture: root.id, version: version.id })
  return {
    path, title: version.first_page_title && !version.second_page_title ? version.first_page_title : 'Website architecture',
    number: version.version_number,
    approved: workspace.artifactReviews.some(row => row.artifact_id === root.id && row.artifact_version_id === version.id && row.decision === 'approved'),
  }
}

function currentArchitectureVersion(versions) {
  return versions.reduce((latest, row) => !latest || row.version_number > latest.version_number ? row : latest, null)
}

export function matchesArchitectureEditor(workspace, artifactId, versionId) {
  const roots = workspace.artifacts.filter(row => row.artifact_type === 'website_architecture')
  if (roots.length !== 1 || !artifactId || !versionId || roots[0].id !== artifactId) return false
  return currentArchitectureVersion(workspace.versions.filter(row => row.artifact_id === artifactId))?.id === versionId
}
