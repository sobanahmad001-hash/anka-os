import {assertEquals, assertRejects} from 'jsr:@std/assert@1.0.14'
import {buildWebsitePublicationBundle, PUBLICATION_TEMPLATE} from './websitePublicationBundle.js'
import {buildWebsiteBlockSource} from './websiteBlockBuild.js'
import {sha} from './websiteStaging.js'
import {createStoredZip} from '../wordpress-export/theme.ts'
import {websiteNativeFixture, bindWebsiteNativeFixture} from '../../../tools/website-native-fixture.js'

async function fixture() {
  const pages: any[] = [], packages: any[] = []
  let site_version_id = ''
  for (const [index, template] of ['home', 'about'].entries()) {
    const manifest = await websiteNativeFixture(template)
    manifest.scope.page_id = 'a0000000-0000-4000-8000-00000000000' + (index + 4)
    const source = {manifest: await bindWebsiteNativeFixture(manifest)}
    const compiled = await buildWebsiteBlockSource(source.manifest)
    const zip = createStoredZip(Object.entries(compiled.files).sort(([a], [b]) => a.localeCompare(b)).map(([name, text]) => ({name: compiled.directory + '/' + name, bytes: new TextEncoder().encode(text)})))
    const job = {id: 'a0000000-0000-4000-8000-00000000001' + index, artifact_sha256: await sha(zip), seo_verification: {file_hashes: compiled.file_hashes, package_bytes: zip.byteLength}}
    pages.push({page_id: manifest.scope.page_id, page_key: manifest.scope.page_key, job_id: job.id, package_sha256: job.artifact_sha256})
    packages.push({page_id: manifest.scope.page_id, source, job})
    site_version_id = manifest.sources.site_system.version_id
  }
  return {pages, packages, site_version_id}
}

Deno.test('publication compiler preserves original exact page content and emits one shared fixed theme', async () => {
  const context = await fixture(), result = await buildWebsitePublicationBundle(context)
  assertEquals(result.pages.length, 2)
  assertEquals(Object.keys(result.theme.files).sort(), ['functions.php', 'parts/footer.html', 'parts/header.html', 'style.css', 'templates/index.html', 'theme.json'])
  assertEquals(result.theme.files['templates/index.html'], PUBLICATION_TEMPLATE)
  assertEquals(result.payload_sha256, (await buildWebsitePublicationBundle(context)).payload_sha256)
  assertEquals(result.pages[0].post_content, (await buildWebsiteBlockSource(context.packages[0].source.manifest)).page.post_content)
})
Deno.test('publication compiler rejects a tampered canonical package checksum', async () => {
  const context = await fixture(); context.packages[0].job.seo_verification.file_hashes['functions.php'] = 'f'.repeat(64)
  await assertRejects(() => buildWebsitePublicationBundle(context), Error, 'file hashes differ')
})
Deno.test('publication compiler does not substitute missing packages or duplicate page identities', async () => {
  const context = await fixture(); context.packages[1] = context.packages[0]
  await assertRejects(() => buildWebsitePublicationBundle(context), Error, 'ambiguous')
  const duplicate = await fixture(); duplicate.pages[1] = duplicate.pages[0]
  await assertRejects(() => buildWebsitePublicationBundle(duplicate), Error, 'one original package')
})
Deno.test('one shared site-system identity is required for every compiled page', async () => {
  const context = await fixture(); context.site_version_id = 'a0000000-0000-4000-8000-999999999999'
  await assertRejects(() => buildWebsitePublicationBundle(context), Error, 'identity differs')
})
