import { serializeContentArtifact, websitePageKey } from './contentStudio.js'

const FIELDS = ['slug', 'title', 'parent_page_key', 'position', 'page_type', 'purpose',
  'audience', 'sections', 'conversion_action', 'source_version_ids', 'keyword_strategy_version_id']

export function websiteSitemapPreview(editor, latest = null, workspace = {}) {
  const pages = serializeContentArtifact('website_architecture', editor).pages
  const prior = latest?.content?.pages || []
  const previousByKey = new Map(prior.map(page => [websitePageKey(page), page]))
  const nextByKey = new Map(pages.map(page => [websitePageKey(page), page]))
  const entries = pages.map(page => {
    const before = previousByKey.get(page.page_key)
    const fields = before ? FIELDS.filter(key => JSON.stringify(before[key] ?? null) !== JSON.stringify(page[key] ?? null)) : []
    return { key: page.page_key, title: page.title, slug: page.slug, parentKey: page.parent_page_key,
      kind: !before ? 'added' : fields.length ? 'changed' : 'unchanged', fields }
  })
  for (const before of prior) {
    if (!nextByKey.has(websitePageKey(before))) {
      entries.push({ key: websitePageKey(before), title: before.title, slug: before.slug,
        parentKey: before.parent_page_key || null, kind: 'removed', fields: [] })
    }
  }

  const errors = []
  for (const page of pages) {
    const visited = new Set([page.page_key])
    let parentKey = page.parent_page_key
    while (parentKey) {
      if (!nextByKey.has(parentKey)) { errors.push(`Parent page is missing for ${page.title || page.page_key}.`); break }
      if (visited.has(parentKey)) { errors.push(`Page hierarchy has a cycle at ${page.title || page.page_key}.`); break }
      visited.add(parentKey)
      parentKey = nextByKey.get(parentKey).parent_page_key
    }
  }
  const roots = []
  const children = new Map(pages.map(page => [page.page_key, []]))
  for (const page of pages) (page.parent_page_key ? children.get(page.parent_page_key) : roots)?.push(page)
  const tree = []
  function visit(page, depth) {
    tree.push({ key: page.page_key, title: page.title, slug: page.slug, depth, purpose: page.purpose })
    for (const child of children.get(page.page_key) || []) visit(child, depth + 1)
  }
  if (!errors.length) roots.forEach(page => visit(page, 0))

  const artifactIds = new Set((workspace.artifacts || []).filter(item =>
    ['content', 'keyword_strategy'].includes(item.artifact_type)).map(item => item.id))
  const sourceVersions = new Map((workspace.versions || []).map(version => [version.id, version]))
  const latestVersions = new Map()
  for (const version of workspace.versions || []) {
    if (!artifactIds.has(version.artifact_id)) continue
    const priorVersion = latestVersions.get(version.artifact_id)
    if (!priorVersion || version.version_number > priorVersion.version_number) latestVersions.set(version.artifact_id, version)
  }
  const downstream = new Map()
  function record(key, label) {
    if (!key) return
    const labels = downstream.get(key) || new Set()
    labels.add(label)
    downstream.set(key, labels)
  }
  for (const version of latestVersions.values()) {
    const sourceId = version.content?.source_architecture_version_id
    const sameRoot = sourceId === latest?.id || (latest?.artifact_id
      && sourceVersions.get(sourceId)?.artifact_id === latest.artifact_id)
    if (!sourceId || !sameRoot) continue
    if (version.content?.output_type === 'website_page_copy') record(version.content.target_page_key, 'saved page copy')
    for (const keyword of version.content?.keywords || []) {
      if (keyword.target_kind === 'page') record(keyword.target_page_key, 'keyword target')
    }
  }
  for (const task of workspace.contentTasks || []) record(task.linked_page_key, 'content task')
  const affected = entries.filter(item => ['changed', 'removed'].includes(item.kind))
    .map(item => ({ ...item, dependents: [...(downstream.get(item.key) || [])] }))
  const changed = entries.filter(item => item.kind !== 'unchanged')
  return { pages, tree, entries, affected, changed, errors,
    signature: JSON.stringify({ latestVersionId: latest?.id || null, pages }) }
}
