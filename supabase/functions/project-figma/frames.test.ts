import { frameLink, listFrames } from './frames.ts'
import { FigmaReadError, readDesignFile } from './provider.ts'

Deno.test('provider reports lost access, a missing file, and rate limits', async () => {
  for (const [responseStatus, expected] of [[403,403],[404,404],[429,429]]) {
    try {
      await readDesignFile('DesignA', 'fixture', async (url, init) => {
        if (url !== 'https://api.figma.com/v1/files/DesignA' || init?.redirect !== 'error') {
          throw Error('Unexpected Figma request')
        }
        return new Response(null, { status: responseStatus })
      })
    } catch (error) {
      if (error instanceof FigmaReadError && error.status === expected) continue
      throw error
    }
    throw Error('Failed provider request returned as a success')
  }
})

Deno.test('nested frames with the same name retain separate node identities', () => {
  const child = { id: '2:4', type: 'FRAME', name: 'Hero' }
  const parent = { ...child, id: '2:3', children: [child] }
  const page = { id: '2:1', type: 'CANVAS', name: 'Website', children: [parent] }
  const frames = listFrames({ id: '0:0', type: 'DOCUMENT', name: '', children: [page] })
  if (frames.length !== 2 || frames[0].id !== '2:3' || frames[1].id !== '2:4') throw Error('Frame traversal failed')
  if (frames.some(frame => frame.page !== 'Website')) throw Error('Page identity lost')
})

Deno.test('reopening a frame addresses the selected file, node and version', () => {
  const href = frameLink('ExampleFile', '2:4', '123')
  if (href !== 'https://www.figma.com/design/ExampleFile?node-id=2-4&version-id=123') throw Error(href)
  if (frameLink('ExampleFile', '2:4', '124') === href) throw Error('Versions collapsed')
})
