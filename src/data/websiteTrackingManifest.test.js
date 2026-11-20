import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x
const hash=s=>crypto.createHash('sha256').update(s).digest('hex')
test('daily worker manifest and native registry pin every reviewed dependency',()=>{
 const m=JSON.parse(fs.readFileSync('supabase/functions/website-tracking/manifest.json','utf8'))
 for(const [file,digest] of Object.entries(m.implementationFiles))assert.equal(hash(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n')),digest,file)
 const contract=Object.fromEntries(Object.entries(m.adapter).filter(([k])=>k!=='manifestSha256'))
 assert.equal(hash(JSON.stringify(canonical({contract,implementationFiles:m.implementationFiles}))),m.adapter.manifestSha256)
 const sql=fs.readFileSync(m.registryMigration,'utf8')
 assert.ok(sql.includes(m.adapter.manifestSha256)&&sql.includes(m.adapter.sourceContract))
})
