import test from 'node:test'
import assert from 'node:assert/strict'
import {uploadIdentity,duplicateUpload} from './workCardAssetUpload.js'

test('an interrupted upload can reuse the same immutable path after reload',async()=>{
 const hash=await uploadIdentity(new Blob(['abc']))
 assert.equal(hash,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
 assert.equal(await uploadIdentity(new Blob(['abc'])),hash)
 assert.notEqual(await uploadIdentity(new Blob(['changed'])),hash)
})
test('only storage conflicts permit a registration retry',()=>{
 assert.equal(duplicateUpload({statusCode:'409'}),true)
 assert.equal(duplicateUpload({error:'Duplicate'}),true)
 assert.equal(duplicateUpload({statusCode:403}),false)
})
