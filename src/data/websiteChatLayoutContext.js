const MARKER='\n\n[Anka Website layout request v1]\n'
export function appendWebsiteLayoutRequest(text,context){
 if(typeof text!=='string'||!text.trim()||!context||typeof context.binding_key!=='string'||!/^[a-f0-9]{64}$/.test(context.binding_key)||typeof context.instructions!=='string'||context.instructions.length>3000)throw Error('Exact selected Website layout context required')
 const value=text+MARKER+JSON.stringify({binding_key:context.binding_key,instructions:context.instructions})
 if(value.length>8000)throw Error('Shorten your message before including the Website layout context; nothing is truncated or sent')
 return value
}
export function parseWebsiteLayoutRequest(body){
 if(typeof body!=='string'||body.length>8000)return null
 const index=body.lastIndexOf(MARKER);if(index<0)return null
 try{const context=JSON.parse(body.slice(index+MARKER.length));if(Object.keys(context).length!==2||typeof context.binding_key!=='string'||!/^[a-f0-9]{64}$/.test(context.binding_key)||typeof context.instructions!=='string'||context.instructions.length>3000)return null;return {text:body.slice(0,index),context}}catch{return null}
}
