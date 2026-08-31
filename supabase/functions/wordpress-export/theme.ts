export type ThemeAsset = {
  storagePath: string
  contentType: string
  bytes: Uint8Array
}

export type SeoVerification = {
  title_matches: boolean
  meta_description_matches: boolean
  heading_hierarchy_preserved: boolean
  image_alt_text_preserved: boolean
  all_checks_passed: boolean
  manual_checklist: string[]
}

export type ThemeBuild = {
  bytes: Uint8Array
  sha256: string
  filename: string
  themeDirectory: string
  seoVerification: SeoVerification
}

const encoder = new TextEncoder()
const INTERNAL_MEDIA_MARKER = '/storage/v1/object/sign/design-generated-media/'
const MANUAL_CHECKLIST = [
  'Preview the installed theme and confirm the browser title matches the approved page.',
  'Confirm the meta description is present before publishing.',
  'Confirm the H1/H2/H3 reading order is correct on desktop and mobile.',
  'Confirm every visible image has meaningful alternative text.',
]

function cleanText(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function wordpressSlug(value: unknown) {
  return cleanText(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60) || 'page'
}

function decodeHtml(value: string) {
  return value.replace(/&#(x?[0-9a-f]+);/gi, (_match, number: string) => {
    const hexadecimal = number[0].toLowerCase() === 'x'
    const code = Number.parseInt(hexadecimal ? number.slice(1) : number, hexadecimal ? 16 : 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : ''
  }).replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function titleFrom(html: string) {
  return decodeHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '')
}

function descriptionFrom(html: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) || []
  const tag = tags.find(item => /\bname\s*=\s*(["'])description\1/i.test(item)) || ''
  const match = tag.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i)
  return decodeHtml(match?.[2]?.trim() || '')
}

function headingSequence(html: string) {
  return [...html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map(match => `h${match[1]}:${match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`)
}

function imageAlts(html: string) {
  const withoutPhp = html.replace(/<\?php[\s\S]*?\?>/gi, 'ANKA_THEME_ASSET_URL')
  return (withoutPhp.match(/<img\b[^>]*>/gi) || []).map(tag => {
    const match = tag.match(/\balt\s*=\s*(["'])([\s\S]*?)\1/i)
    return match ? decodeHtml(match[2].trim()) : ''
  })
}

function bodyFrom(html: string) {
  return html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]?.trim() || ''
}

function assertSafeSource(html: string, css: string) {
  if (!/^<!doctype html>/i.test(html) || !/<html\b/i.test(html) || !/<body\b/i.test(html)) {
    throw new Error('The approved page is not a complete HTML document')
  }
  if (/<script\b|<iframe\b|<object\b|<embed\b|javascript\s*:|\son[a-z]+\s*=/i.test(html)) {
    throw new Error('The approved page contains executable or embedded content')
  }
  if (!titleFrom(html) || !descriptionFrom(html)) {
    throw new Error('The approved page must include a title and meta description')
  }
  if (!bodyFrom(html) || !cleanText(css, 200000)) throw new Error('The approved page has no exportable body or CSS')
}

function extensionFor(asset: ThemeAsset) {
  const pathExtension = asset.storagePath.match(/\.([a-z0-9]{2,5})(?:$|\?)/i)?.[1]?.toLowerCase()
  if (pathExtension && ['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'].includes(pathExtension)) return pathExtension
  const subtype = asset.contentType.split('/')[1]?.toLowerCase().replace('svg+xml', 'svg')
  return subtype && ['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'].includes(subtype) ? subtype : 'bin'
}

function signedStoragePath(urlValue: string) {
  try {
    const url = new URL(urlValue)
    const markerIndex = url.pathname.indexOf(INTERNAL_MEDIA_MARKER)
    if (markerIndex < 0) return null
    return decodeURIComponent(url.pathname.slice(markerIndex + INTERNAL_MEDIA_MARKER.length))
  } catch {
    return null
  }
}

export function referencedMediaPaths(...values: string[]) {
  const paths = values.flatMap(value => [...value.matchAll(/https?:\/\/[^\s"'()<>]+/gi)]
    .map(match => signedStoragePath(match[0])).filter((path): path is string => Boolean(path)))
  return [...new Set(paths)]
}

function replaceAssetUrls(value: string, replacements: Map<string, string>, php: boolean) {
  return value.replace(/https?:\/\/[^\s"'()<>]+/gi, candidate => {
    const storagePath = signedStoragePath(candidate)
    const relative = storagePath ? replacements.get(storagePath) : null
    if (!relative) return candidate
    return php
      ? `<?php echo esc_url( get_template_directory_uri() ); ?>/${relative}`
      : relative
  })
}

function u16(value: number) {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, true)
  return bytes
}

function u32(value: number) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true)
  return bytes
}

function join(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function createStoredZip(files: Array<{ name: string; bytes: Uint8Array }>) {
  const local: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name.replaceAll('\\', '/'))
    const crc = crc32(file.bytes)
    const localHeader = join([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(file.bytes.length), u32(file.bytes.length), u16(name.length), u16(0), name,
    ])
    local.push(localHeader, file.bytes)
    central.push(join([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(file.bytes.length), u32(file.bytes.length), u16(name.length), u16(0),
      u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]))
    offset += localHeader.length + file.bytes.length
  }
  const centralBytes = join(central)
  return join([...local, centralBytes, join([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralBytes.length), u32(offset), u16(0),
  ])])
}

function exactArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function themeFiles(slug: string, htmlValue: string, cssValue: string, assets: ThemeAsset[]) {
  const safeHtml = htmlValue.replaceAll('<?', '&lt;?').replaceAll('?>', '?&gt;')
  const safeCss = cssValue.replaceAll('<?', '').replaceAll('?>', '')
  const title = titleFrom(safeHtml)
  const description = descriptionFrom(safeHtml)
  const replacements = new Map<string, string>()
  const assetFiles = assets.map((asset, index) => {
    const relative = `assets/media-${String(index + 1).padStart(2, '0')}.${extensionFor(asset)}`
    replacements.set(asset.storagePath, relative)
    return { name: relative, bytes: asset.bytes }
  })
  const body = replaceAssetUrls(bodyFrom(safeHtml), replacements, true)
  const css = replaceAssetUrls(safeCss, replacements, false)
  if (body.includes(INTERNAL_MEDIA_MARKER) || css.includes(INTERNAL_MEDIA_MARKER)) {
    throw new Error('An approved page references a private image that could not be bundled')
  }
  const themeName = `Anka ${slug.split('-').map(part => part[0]?.toUpperCase() + part.slice(1)).join(' ')}`
  const header = `<!doctype html>\n<html <?php language_attributes(); ?>>\n<head>\n<meta charset="<?php bloginfo( 'charset' ); ?>">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<meta name="description" content="${escapeHtml(description)}">\n<?php wp_head(); ?>\n</head>\n<body <?php body_class(); ?>>\n<?php wp_body_open(); ?>\n`
  const index = `<?php get_header(); ?>\n${body}\n<?php get_footer(); ?>\n`
  const footer = `<?php wp_footer(); ?>\n</body>\n</html>\n`
  const functions = `<?php\nfunction anka_theme_setup() {\n  add_theme_support( 'post-thumbnails' );\n  add_theme_support( 'responsive-embeds' );\n  add_theme_support( 'html5', array( 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style' ) );\n}\nadd_action( 'after_setup_theme', 'anka_theme_setup' );\n\nfunction anka_theme_assets() {\n  wp_enqueue_style( 'anka-theme', get_stylesheet_uri(), array(), wp_get_theme()->get( 'Version' ) );\n}\nadd_action( 'wp_enqueue_scripts', 'anka_theme_assets' );\n`
  const style = `/*\nTheme Name: ${themeName}\nDescription: Native Anka OS export of the approved ${slug} page design.\nVersion: 1.0.0\nRequires at least: 6.0\nRequires PHP: 7.4\nText Domain: anka-${slug}\n*/\n\n${css}\n`
  const readme = `ANKA OS NATIVE WORDPRESS THEME EXPORT\n\nThis theme contains one approved standalone page design. It does not publish or deploy a site.\n\nPre-publish SEO checklist:\n${MANUAL_CHECKLIST.map(item => `- ${item}`).join('\n')}\n`
  return {
    title, description, body,
    files: [
      { name: 'style.css', bytes: encoder.encode(style) },
      { name: 'index.php', bytes: encoder.encode(index) },
      { name: 'header.php', bytes: encoder.encode(header) },
      { name: 'footer.php', bytes: encoder.encode(footer) },
      { name: 'functions.php', bytes: encoder.encode(functions) },
      { name: 'readme.txt', bytes: encoder.encode(readme) },
      ...assetFiles,
    ],
    generated: { header, index },
  }
}

export async function buildWordPressTheme(
  slugValue: unknown,
  htmlValue: unknown,
  cssValue: unknown,
  assets: ThemeAsset[] = [],
): Promise<ThemeBuild> {
  const html = cleanText(htmlValue, 500000)
  const css = cleanText(cssValue, 200000)
  assertSafeSource(html, css)
  const slug = wordpressSlug(slugValue)
  const directory = `anka-${slug}`
  const built = themeFiles(slug, html, css, assets)
  const sourceHeadings = headingSequence(html)
  const outputHeadings = headingSequence(built.generated.index)
  const sourceAlts = imageAlts(html)
  const outputAlts = imageAlts(built.generated.index)
  const verification: SeoVerification = {
    title_matches: built.generated.header.includes(`<title>${escapeHtml(titleFrom(html))}</title>`),
    meta_description_matches: built.generated.header.includes(`content="${escapeHtml(descriptionFrom(html))}"`),
    heading_hierarchy_preserved: sourceHeadings.length > 0 && exactArray(sourceHeadings, outputHeadings),
    image_alt_text_preserved: sourceAlts.every(Boolean) && exactArray(sourceAlts, outputAlts),
    all_checks_passed: false,
    manual_checklist: [...MANUAL_CHECKLIST],
  }
  verification.all_checks_passed = verification.title_matches && verification.meta_description_matches
    && verification.heading_hierarchy_preserved && verification.image_alt_text_preserved
  if (!verification.all_checks_passed) {
    throw new Error(`SEO preservation checks failed: ${JSON.stringify(verification)}`)
  }
  const zip = createStoredZip(built.files.map(file => ({ name: `${directory}/${file.name}`, bytes: file.bytes })))
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', zip))
  return {
    bytes: zip,
    sha256: [...hash].map(byte => byte.toString(16).padStart(2, '0')).join(''),
    filename: `${directory}.zip`,
    themeDirectory: directory,
    seoVerification: verification,
  }
}
