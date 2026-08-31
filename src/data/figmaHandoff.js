export function figmaHandoffPath(requestId) {
  return `/sphere/content/requests/${encodeURIComponent(requestId)}/figma-handoff`
}

export function requestReferenceAssets(request, assets = []) {
  return assets.filter(asset => asset.content_request_id === request.id)
}

export function recentBrandRequests(request, requests = [], limit = 6) {
  return requests
    .filter(item => item.id !== request.id && item.brand_id === request.brand_id)
    .slice(0, limit)
}
