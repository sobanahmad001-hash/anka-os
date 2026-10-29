// Rebuild only canonical, previously saved native packages; no arbitrary files or remote assets.
import {stagingBundle, sha} from './websiteStaging.js'
import {websiteNativeSnapshotChecksum} from './websiteNativeDesign.js'

const sharedPaths = ['functions.php', 'style.css', 'theme.json', 'parts/header.html', 'parts/footer.html']
export const PUBLICATION_TEMPLATE = '<!-- wp:template-part {"slug":"header","area":"header"} /--><!-- wp:group {"tagName":"main","anchor":"main"} --><main id="main" class="wp-block-group"><!-- wp:post-content /--></main><!-- /wp:group --><!-- wp:template-part {"slug":"footer","area":"footer"} /-->'

export async function buildWebsitePublicationBundle(context) {
  if (!Array.isArray(context?.pages) || context.pages.length < 1 || context.pages.length > 100 || !Array.isArray(context.packages) || context.packages.length !== context.pages.length) throw Error('Exact server-resolved publication packages required')
  const pages = [], seen = new Set()
  /** @type {Record<string,string>|undefined} */
  let files
  for (const selected of context.pages) {
    if (seen.has(selected.page_id)) throw Error('Each publication page requires one original package')
    seen.add(selected.page_id)
    const packages = context.packages.filter(row => row.page_id === selected.page_id)
    if (packages.length !== 1) throw Error('Exact original publication package is missing or ambiguous')
    const canonical = packages[0]
    if (canonical.job.id !== selected.job_id || canonical.job.artifact_sha256 !== selected.package_sha256 || canonical.source.manifest?.scope.page_id !== selected.page_id || canonical.source.manifest.scope.page_key !== selected.page_key || canonical.source.manifest.sources.site_system.version_id !== context.site_version_id) throw Error('Canonical page package identity differs')
    const bundle = await stagingBundle(canonical)
    // Individual review ZIPs advertise their content-filled preview template. Published pages
    // use their immutable post content through the single fixed template instead.
    const theme = JSON.parse(bundle.files['theme.json'])
    delete theme.customTemplates
    const shared = {...Object.fromEntries(sharedPaths.map(path => [path, bundle.files[path]])), 'theme.json': JSON.stringify(theme, null, 2)}
    if (files && sharedPaths.some(path => shared[path] !== files[path])) throw Error('Selected pages compile different shared themes; review one consistent site system')
    files ||= shared
    pages.push({page_id: selected.page_id, page_key: selected.page_key, job_id: selected.job_id, package_sha256: selected.package_sha256, title: bundle.page.title, meta_description: bundle.page.meta_description, post_content: bundle.page.post_content})
  }
  if (!files) throw Error('At least one exact native page package is required')
  files['templates/index.html'] = PUBLICATION_TEMPLATE
  /** @type {Record<string,string>} */
  const file_hashes = {}
  for (const [path, content] of Object.entries(files)) file_hashes[path] = await sha(new TextEncoder().encode(content))
  const theme_sha256 = await websiteNativeSnapshotChecksum(files)
  const payload = {compiler: 'anka-publication-v1', site_version_id: context.site_version_id, theme: {files, file_hashes, theme_sha256}, pages}
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 4194304) throw Error('Publication payload exceeds four MiB; review a smaller explicit selection')
  return {...payload, payload_sha256: await websiteNativeSnapshotChecksum(payload)}
}
