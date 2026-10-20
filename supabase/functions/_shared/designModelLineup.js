// Official bounded API request contracts verified 2026-10-21.
// Transport capability is not authority or pricing. Existing server guards remain required.
// No prices or account access are inferred; unsupported output formats fail closed.
const aspects=['16:9','4:3','1:1','3:4','9:16'];
const ideogramAspects=['1:1','1:2','2:1','2:3','3:2','4:5','5:4','9:16','16:9','5:8','8:5','3:4','4:3','9:22','22:9','9:23','23:9','3:8','8:3','5:12','12:5','1:3','3:1'];
const int=(min,max)=>Object.assign(v=>Number.isInteger(v)&&v>=min&&v<=max,{type:'integer',min,max});
const number=(min,max)=>Object.assign(v=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max,{type:'number',min,max});
const one=values=>Object.assign(v=>values.includes(v),{options:Object.freeze(values)});
const boolean=Object.assign(v=>typeof v==='boolean',{type:'boolean'});
/** @typedef {((value: unknown)=>boolean) & {options?: readonly (string|number|boolean)[], type?: string, min?: number, max?: number}} Field */
/** @typedef {{kind:'image'|'video', input:boolean, maxPrompt:number, minPrompt:number, fields:Record<string,Field>, defaults:Record<string,string|number|boolean>}} Contract */
/** @type {Record<string,Contract>} */
const definitions={
 'ideogram/v4.0':{kind:'image',input:false,maxPrompt:2048,minPrompt:2,fields:{aspect_ratio:one(ideogramAspects),rendering_speed:one(['TURBO','DEFAULT','QUALITY'])},defaults:{aspect_ratio:'16:9',rendering_speed:'DEFAULT'}},
 'recraft/v4.1/text-to-image':{kind:'image',input:false,maxPrompt:10000,minPrompt:1,fields:{resolution:one(['1k']),aspect_ratio:one(['1:1','2:1','1:2','3:2','2:3','4:3','3:4','5:4','4:5','6:10','14:10','10:14','16:9','9:16']),output_format:one(['png'])},defaults:{resolution:'1k',aspect_ratio:'16:9',output_format:'png'}},
 'xai/grok-imagine-image-2.0':{kind:'image',input:false,maxPrompt:12000,minPrompt:1,fields:{quality:one(['low','medium']),resolution:one(['1k','2k']),aspect_ratio:one(['auto','1:1','1:2','2:1','3:2','2:3','4:3','3:4','16:9','9:16'])},defaults:{quality:'medium',resolution:'1k',aspect_ratio:'16:9'}},
 'minimax/h3/text-to-video':{kind:'video',input:false,maxPrompt:12000,minPrompt:1,fields:{duration:int(5,15),resolution:one(['2K']),aspect_ratio:one(['auto','adaptive','21:9',...aspects]),aigc_watermark:boolean},defaults:{duration:5,resolution:'2K',aspect_ratio:'16:9',aigc_watermark:false}},
 'lightricks/ltx-2.5/image-to-video/fast':{kind:'video',input:true,maxPrompt:5000,minPrompt:2,fields:{fps:one([24,25,48,50]),duration:one([6,8,10]),resolution:one(['720p','1080p','2k','4k']),aspect_ratio:one(['16:9','9:16']),generate_audio:boolean},defaults:{fps:25,duration:6,resolution:'720p',aspect_ratio:'16:9',generate_audio:false}},
};
for(const mode of ['text','image']){
 const input=mode==='image';
 definitions[`kling-video/v3.0/std/${mode}-to-video`]={kind:'video',input,maxPrompt:12000,minPrompt:1,fields:{sound:one(['on','off']),duration:int(3,15),cfg_scale:number(0,1),multi_shots:one([false]),...(!input?{aspect_ratio:one(['16:9','9:16','1:1'])}:{})},defaults:{sound:'off',duration:5,cfg_scale:0.5,multi_shots:false,...(!input?{aspect_ratio:'16:9'}:{})}};
 definitions[`alibaba/wan-3.0/${mode}-to-video`]={kind:'video',input,maxPrompt:12000,minPrompt:1,fields:{duration:int(2,30),resolution:one(['480p','720p','1080p']),aspect_ratio:one([...aspects,'adaptive']),generate_audio:boolean,enable_thinking:one([false])},defaults:{duration:5,resolution:'720p',aspect_ratio:'16:9',generate_audio:false,enable_thinking:false}};
}
for(const spec of Object.values(definitions)){for(const validator of Object.values(spec.fields))Object.freeze(validator);Object.freeze(spec.fields);Object.freeze(spec.defaults);Object.freeze(spec)}
export const LINEUP_CONTRACTS=Object.freeze(definitions);
// Receives only an already-authorized signed image URL from the dispatch owner.
// Authorization/checksum/consent remain mandatory outside this pure serializer.
export function buildLineupInput(model,prompt,settings,count,resolvedImageUrl){
 const spec=LINEUP_CONTRACTS[model];if(!spec)throw Error('Unsupported exact model');
 if(typeof prompt!=='string'||prompt.trim().length<spec.minPrompt||prompt.length>spec.maxPrompt)throw Error('Confirmed brief exceeds this model contract; do not truncate');
 if(count!==1)throw Error('This model contract supports one output per request');
 if(!settings||typeof settings!=='object'||Array.isArray(settings)||Object.keys(settings).sort().join('|')!==Object.keys(spec.fields).sort().join('|'))throw Error('Exact model settings required');
 for(const [key,validate] of Object.entries(spec.fields))if(!validate(settings[key]))throw Error('Unsupported model setting: '+key);
 if(spec.input){let url;try{url=new URL(resolvedImageUrl)}catch{throw Error('Resolved image required')}if(url.protocol!=='https:'||url.username||url.password||resolvedImageUrl.length>4096)throw Error('Invalid resolved image')}
 else if(resolvedImageUrl!==undefined)throw Error('Unexpected image input');
 return {prompt:prompt.trim(),...Object.fromEntries(Object.keys(spec.fields).map(k=>[k,settings[k]])),...(spec.input?{image_url:resolvedImageUrl}:{})};
}

/** @type {Readonly<Record<string,string>>} */
export const LINEUP_LABELS=Object.freeze({'higgsfield-ai/soul/v2/standard':'Soul 2','higgsfield-ai/soul/v2/image-to-image':'Soul 2 image-guided','bytedance/seedance-2.5/text-to-video':'Seedance 2.5','bytedance/seedance-2.5/image-to-video':'Seedance 2.5','gpt-image-1':'GPT Image 1','gpt-image-1-mini':'GPT Image 1 Mini','gpt-image-1.5':'GPT Image 1.5','ideogram/v4.0':'Ideogram 4.0','recraft/v4.1/text-to-image':'Recraft 4.1','xai/grok-imagine-image-2.0':'Grok Imagine 2.0','minimax/h3/text-to-video':'MiniMax H3','lightricks/ltx-2.5/image-to-video/fast':'LTX 2.5 Fast','kling-video/v3.0/std/text-to-video':'Kling 3.0 Standard','kling-video/v3.0/std/image-to-video':'Kling 3.0 Standard','alibaba/wan-3.0/text-to-video':'Wan 3.0','alibaba/wan-3.0/image-to-video':'Wan 3.0'});
export function mediaKind(model){return LINEUP_CONTRACTS[model]?.kind||(['bytedance/seedance-2.5/text-to-video','bytedance/seedance-2.5/image-to-video'].includes(model)?'video':['higgsfield-ai/soul/v2/standard','higgsfield-ai/soul/v2/image-to-image','gpt-image-1','gpt-image-1-mini','gpt-image-1.5'].includes(model)?'image':null)}
export function requiresImage(model){return LINEUP_CONTRACTS[model]?.input===true||['bytedance/seedance-2.5/image-to-video','higgsfield-ai/soul/v2/image-to-image'].includes(model)}
export function isAnimationModel(model){return requiresImage(model)&&mediaKind(model)==='video'}
const MODEL_ORDER=Object.freeze(['ideogram/v4.0','higgsfield-ai/soul/v2/standard','recraft/v4.1/text-to-image','xai/grok-imagine-image-2.0','bytedance/seedance-2.5/text-to-video','bytedance/seedance-2.5/image-to-video','kling-video/v3.0/std/text-to-video','kling-video/v3.0/std/image-to-video','alibaba/wan-3.0/text-to-video','alibaba/wan-3.0/image-to-video','lightricks/ltx-2.5/image-to-video/fast','minimax/h3/text-to-video']);
export function modelOrder(model){const index=MODEL_ORDER.indexOf(model);return index<0?100:index}
