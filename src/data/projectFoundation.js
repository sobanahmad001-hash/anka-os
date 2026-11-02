// Intent only. The server resolves authority, source approval and immutable pins.
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key))
export function validateProjectFoundation(value){
 if(!keys(value,['version','engagement_id','written','visual'])||value.version!==1||!uuid(value.engagement_id))throw Error('Review exact versioned project foundation context')
 const result={version:1,engagement_id:value.engagement_id}
 for(const role of ['written','visual']){
  const pin=value[role]
  if(pin===undefined||pin===null){result[role]=null;continue}
  if(pin.mode==='minimum'){
   if(!keys(pin,['mode','guidance','reason'])||typeof pin.guidance!=='string'||!pin.guidance.trim()||pin.guidance.length>4000||typeof pin.reason!=='string'||!pin.reason.trim()||pin.reason.length>1000)throw Error('Review bounded minimum guidance and its limited-scope reason')
   result[role]={mode:'minimum',guidance:pin.guidance.trim(),reason:pin.reason.trim()}
  }else{
   if(!keys(pin,['mode','artifact_id','version_id','checksum','approval_id'])||pin.mode!=='approved_version'||![pin.artifact_id,pin.version_id,pin.approval_id].every(uuid)||typeof pin.checksum!=='string'||!/^[a-f0-9]{64}$/.test(pin.checksum))throw Error('Select an exact approved foundation version and approval')
   result[role]={mode:'approved_version',artifact_id:pin.artifact_id,version_id:pin.version_id,checksum:pin.checksum,approval_id:pin.approval_id}
  }
 }
 return result
}

export function foundationForSetup(proposal,snapshot){
 // Older callers retain the saved exact intent. Explicit null is never a reset.
 const intent=proposal.foundation===undefined?snapshot.state?.plan?.foundation?.intent:proposal.foundation
 return intent===undefined?undefined:validateProjectFoundation(intent)
}
