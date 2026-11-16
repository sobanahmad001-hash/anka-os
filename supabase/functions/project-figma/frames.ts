interface FigmaNode {
  id: string
  type: string
  name: string
  children?: FigmaNode[]
}

export function listFrames(document: FigmaNode) {
  const frames: { id: string; name: string; page: string }[] = []
  for (const page of document.children ?? []) {
    const pending = [...(page.children ?? [])].reverse()
    while (pending.length) {
      const node = pending.pop()!
      if (node.type === 'FRAME') frames.push({ id: node.id, name: node.name, page: page.name })
      for (let index = (node.children?.length ?? 0) - 1; index >= 0; index--) {
        pending.push(node.children![index])
      }
    }
  }
  return frames
}

export function frameLink(fileKey: string, nodeId: string, version: string) {
  if (!/^[A-Za-z0-9]+$/.test(fileKey) || !/^\d+:\d+$/.test(nodeId) || !version) {
    throw new Error('Invalid Figma reference')
  }
  const url = new URL('https://www.figma.com/design/' + fileKey)
  url.searchParams.set('node-id', nodeId.replace(':', '-'))
  url.searchParams.set('version-id', version)
  return url.href
}
