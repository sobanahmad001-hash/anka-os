export function composePageDesignPreview(htmlContent, cssContent) {
  const html = typeof htmlContent === 'string' ? htmlContent : ''
  const css = typeof cssContent === 'string' ? cssContent : ''
  const style = `<style data-anka-page-design>\n${css}\n</style>`
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}\n</head>`) : `${style}\n${html}`
}

export function latestArchitecturePages(artifacts, versions) {
  const architecture = artifacts.find(item => item.artifact_type === 'website_architecture')
  const latest = versions.filter(item => item.artifact_id === architecture?.id)
    .sort((left, right) => right.version_number - left.version_number)[0]
  return Array.isArray(latest?.content?.pages) ? latest.content.pages : []
}
