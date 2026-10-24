export const VIDEO_REFERENCE_MAX_BYTES = 20 * 1024 * 1024
export function inspectVideoReference(bytes, mime) {
 if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes.length > VIDEO_REFERENCE_MAX_BYTES) throw Error('Choose an MP4/MOV original up to 20 MiB')
 if (!['video/mp4','video/quicktime'].includes(mime)) throw Error('MP4 or MOV required')
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), str=(a,b)=>String.fromCharCode(...bytes.slice(a,b))
 let offset=0,boxes=0,ftyp=false,moov=false,mdat=false
 while(offset<bytes.length) {
  if(++boxes>4096 || offset+8>bytes.length) throw Error('Invalid video container')
  let size=view.getUint32(offset);const kind=str(offset+4,offset+8);let header=8
  if(size===1){if(offset+16>bytes.length)throw Error('Invalid video container');const big=view.getBigUint64(offset+8);if(big>BigInt(VIDEO_REFERENCE_MAX_BYTES))throw Error('Video box too large');size=Number(big);header=16}
  if(size===0)size=bytes.length-offset
  if(size<header || offset+size>bytes.length)throw Error('Invalid video container')
  if(kind==='ftyp'){
   if(offset!==0||size<header+8)throw Error('Invalid video signature')
   const brand=str(offset+header,offset+header+4)
   if(mime==='video/quicktime'?brand!=='qt  ':!['isom','iso2','mp41','mp42','avc1','M4V ','dash'].includes(brand))throw Error('Video MIME and container differ')
   ftyp=true
  }
  if(kind==='moov')moov=size>header
  if(kind==='mdat')mdat=size>header
  offset+=size
 }
 if(!ftyp||!moov||!mdat)throw Error('Incomplete video container')
 return {verifiedMime:mime,extractionKind:'reference_only',extractedText:null,extractionNotice:'Private reference only. No playback validation, audio, frames or text extracted; never sent to AI.'}
}
