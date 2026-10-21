// No network: assert exact native-prepared prompt survives the provider adapter.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createDesignMediaAdapter} from './designMediaAdapter.ts'
const prompt=JSON.parse(readFileSync(process.argv[2] || new URL('./test-fixtures/soul-visual-prompt.json',import.meta.url),'utf8')).prompt
let calls=0
globalThis.fetch=()=>{throw Error('Network forbidden in offline test')}
const adapter=createDesignMediaAdapter(config=>{
 assert.equal(config.maxRetries,0)
 return {subscribe:async(endpoint,options)=>{
  calls++
  assert.equal(endpoint,'higgsfield-ai/soul/v2/standard')
  assert.equal(options.input.prompt,prompt)
  assert.equal(options.input.enhance_prompt,false)
  assert.equal(options.input.batch_size,1)
  assert.equal(options.withPolling,false)
  assert.deepEqual(Object.keys(options.input).sort(),['aspect_ratio','batch_size','enhance_prompt','prompt','resolution'])
  return {status:'queued',request_id:'offline-soul',status_url:'https://api.higgsfield.ai/requests/offline-soul/status'}
 }}
},'offline:placeholder')
await adapter.submitImage({prompt,batch_size:1,resolution:'720p',aspect_ratio:'16:9',enhance_prompt:false})
assert.equal(calls,1)
console.log('PASS native prompt forwarded byte-exact; no hidden enhancement, style, polling or retries; zero network')
