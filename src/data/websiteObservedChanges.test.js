import test from 'node:test'
import assert from 'node:assert/strict'
import {observedPageSnapshot,pageSnapshotDiff} from '../../supabase/functions/_shared/websiteObservedChanges.js'
const snapshot=html=>observedPageSnapshot({html,url:'https://example.com/airport',status:200})
test('ignores scripts, timestamps and navigation while retaining meaningful page changes',()=>{
 const page=stamp=>`<title>Airport transfers</title><body><nav>${stamp}</nav><main><h1>Airport</h1><p>Book a ride</p><time>${stamp}</time><script>${stamp}</script></main></body>`
 const before=snapshot(page('old')),same=snapshot(page('new'))
 assert.equal(pageSnapshotDiff(before,same).changed,false)
 const changed=snapshot(page('new').replace('Book a ride','Book a private car'))
 assert.deepEqual(pageSnapshotDiff(before,changed).fields,['content'])
})
test('indexing directives trigger recheck; missing pages retain previous content',()=>{
 const before=snapshot('<main><h1>Hotels</h1><p>Hotels nearby</p></main>')
 const changed=snapshot('<meta name="robots" content="noindex,follow"><main><h1>Hotels</h1><p>Hotels nearby</p></main>')
 assert.ok(pageSnapshotDiff(before,changed).fields.includes('robots'))
 const gone=observedPageSnapshot({html:'',url:before.url,status:404})
 assert.equal(pageSnapshotDiff(before,gone).retainPreviousContent,true)
 assert.equal(pageSnapshotDiff(null,before).baseline,true)
})

test('large multibyte pages and headings stay within the persisted snapshot envelope',()=>{
 const result=snapshot('<main><h1>'+('界'.repeat(100000))+'</h1><p>'+('界'.repeat(100000))+'</p></main>')
 assert.ok(new TextEncoder().encode(JSON.stringify(result)).length<=140000)
 assert.equal(result.contentTruncated,true)
})
