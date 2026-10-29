export default function AttachmentUseStatus({status,selected=false,referenceOnly=false}){
 return <p className="attachment-use-status">{status==='ready'?<>Stored · {referenceOnly?'Reference only':selected?'Selected text source':'Not selected for Send'}{referenceOnly&&selected?' · Selected reference':''}</>:'Upload incomplete · Original request recovery required'}</p>
}
