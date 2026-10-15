const MAX=10*1024*1024
export async function imageOutput(bytes:Uint8Array,mime:string){
 if(bytes.length<12||bytes.length>MAX)throw Error('Original image size is unsupported');
 const png=mime==='image/png'&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
 const jpeg=mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!png&&!jpeg)throw Error('Original image signature is invalid');
 const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer)),x=>x.toString(16).padStart(2,'0')).join('');
 return {bytes,contentType:mime,byteLength:bytes.length,checksum,extension:png?'png':'jpg'};
}
export async function fetchDesignImageOutput(raw:string,hosts:string[],fetcher:typeof fetch=fetch){
 let url:URL;try{url=new URL(raw)}catch{throw Error('Invalid original image URL')}
 const host=url.hostname.toLowerCase();if(raw.length>4096||url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!host.includes('.')||host.endsWith('.local')||!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host)||/^[0-9.]+$/.test(host)||!hosts.includes(host))throw Error('Original image host is not approved');
 const response=await fetcher(url.href,{method:'GET',redirect:'error',signal:AbortSignal.timeout(120000),headers:{Accept:'image/png,image/jpeg'}});
 const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase(),length=Number(response.headers.get('content-length'));
 if(!response.ok||(response.url&&response.url!==url.href)||!['image/png','image/jpeg'].includes(mime||'')||!response.body||(response.headers.has('content-length')&&(!Number.isSafeInteger(length)||length<12||length>MAX)))throw Error('Original image response is unsupported');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX)throw Error('Original image exceeds storage limit');chunks.push(value)}}catch(error){await reader.cancel().catch(()=>{});throw error}finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return imageOutput(bytes,mime!);
}
