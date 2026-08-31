export const WORDPRESS_SEO_CHECKS = Object.freeze([
  ['title_matches', 'Page title preserved'],
  ['meta_description_matches', 'Meta description preserved'],
  ['heading_hierarchy_preserved', 'H1/H2/H3 order preserved'],
  ['image_alt_text_preserved', 'Image alternative text preserved'],
])

export function latestWordPressExportJob(jobs, websitePageDesignId) {
  return [...(jobs || [])]
    .filter(job => job.website_page_design_id === websitePageDesignId)
    .sort((left, right) => new Date(right.requested_at) - new Date(left.requested_at))[0] || null
}

export function wordpressSeoRows(verification) {
  return WORDPRESS_SEO_CHECKS.map(([id, label]) => ({ id, label, passed: verification?.[id] === true }))
}
