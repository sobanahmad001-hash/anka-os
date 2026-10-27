export const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
export function stagingOrigin(value){
 const u=new URL(value)
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(u.hostname)||u.hostname.endsWith('.localhost')||u.hostname.endsWith('.local')||u.hostname.endsWith('.internal'))throw Error('An exact public HTTPS staging origin is required')
 return u.origin
}
