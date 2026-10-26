export async function validatedReferenceOriginal(result,row){
 const blob=result instanceof Response?await result.blob():result
 const mime=row.verified_mime||row.claimed_mime,bytes=row.declared_bytes??row.byte_size,checksum=row.expected_sha256||row.sha256_hex
 if(!(blob instanceof Blob)||!blob.size||blob.size>5*1024*1024||blob.size!==bytes||blob.type.split(';')[0]!==mime||!/^[a-f0-9]{64}$/.test(checksum||''))throw Error('Original readback could not be verified.')
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('')
 if(digest!==checksum)throw Error('Original checksum changed. Reopen the saved reference.')
 return blob
}
