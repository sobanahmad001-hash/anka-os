import test from 'node:test'
import assert from 'node:assert/strict'
import { getPrivateDesignVideoQuote } from './designVideoQuoteTransport.js'
test('private video quote transmits exact settings and anchor only, preserving selected organization and abort scope',async()=>{
 const calls=[];const controller=new AbortController()
 const client={functions:{invoke:async(name,input)=>{calls.push({name,...input});return{data:{data:{quote:null}}}}}}
 await getPrivateDesignVideoQuote(client,'org',{private_conversation_id:'private',duration_seconds:5,resolution:'720p',aspect_ratio:'16:9',output_format:'mp4',generate_audio:false,messages:['omit'],attachments:['omit']},controller.signal)
 assert.equal(calls.length,1);assert.equal(calls[0].body.action,'get_private_video_quote');assert.equal(calls[0].body.organization_id,'org');assert.equal(calls[0].body.private_conversation_id,'private');assert.equal(calls[0].body.direction_version_id,undefined);assert.equal(calls[0].body.messages,undefined);assert.equal(calls[0].body.attachments,undefined);assert.equal(calls[0].signal,controller.signal)
 assert.throws(()=>getPrivateDesignVideoQuote(client,'org',{private_conversation_id:'private',direction_version_id:'direction'}))
 controller.abort();await assert.rejects(getPrivateDesignVideoQuote(client,'org',{private_conversation_id:'private'},controller.signal),{name:'AbortError'})
})