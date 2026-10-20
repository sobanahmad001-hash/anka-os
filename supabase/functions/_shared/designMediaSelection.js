import {LINEUP_CONTRACTS,buildLineupInput} from './designModelLineup.js'
// Supported transport settings, not model grants or paid-execution authority.
// Official references verified 2026-10-15; registry/connector checks remain server-owned.
export const SOUL_GUIDED_MODEL='higgsfield-ai/soul/v2/image-to-image'
export const SOUL_MODEL='higgsfield-ai/soul/v2/standard'
export const SEEDANCE_TEXT_MODEL='bytedance/seedance-2.5/text-to-video'
export const SEEDANCE_INPUT_MODEL='bytedance/seedance-2.5/image-to-video'
export const OPENAI_STILL_MODELS=Object.freeze(['gpt-image-1','gpt-image-1-mini','gpt-image-1.5'])
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==keys.slice().sort().join('|'))throw Error('Exact supported media settings required')}
export function requireSupportedMediaSelection(provider,model,settings,count,inputs){
 if(!Number.isInteger(count)||!Array.isArray(inputs))throw Error('Exact output count and input selection required')
 if(provider==='higgsfield'&&LINEUP_CONTRACTS[model]){const spec=LINEUP_CONTRACTS[model];if(inputs.length!==(spec.input?1:0)||spec.input&&!['design_asset_version','media_output','private_attachment'].includes(inputs[0]?.kind))throw Error('One exact authorized original is required');buildLineupInput(model,'validated brief',settings,count,spec.input?'https://validated.invalid/original':undefined);return spec.kind}
 if(provider==='higgsfield'&&[SOUL_MODEL,SOUL_GUIDED_MODEL].includes(model)){
  const guided=model===SOUL_GUIDED_MODEL;
  if(guided&&(inputs.length!==1||!['design_asset_version','media_output'].includes(inputs[0]?.kind)||settings.enhance_prompt!==true))throw Error('One authorized original and enabled reference processing are required');
  exact(settings,['resolution','aspect_ratio','enhance_prompt']);if(![1,4].includes(count)||inputs.length!==(guided?1:0)||!['720p','1080p'].includes(settings.resolution)||!['9:16','16:9','4:3','3:4','1:1','2:3','3:2'].includes(settings.aspect_ratio)||typeof settings.enhance_prompt!=='boolean')throw Error('Unsupported image settings');return 'image'
 }
 if(provider==='higgsfield'&&[SEEDANCE_TEXT_MODEL,SEEDANCE_INPUT_MODEL].includes(model)){
  const input=model===SEEDANCE_INPUT_MODEL;exact(settings,['duration_seconds','resolution','output_format','generate_audio',...(input?[]:['aspect_ratio'])]);
  if(count!==1||inputs.length!==(input?1:0)||!Number.isInteger(settings.duration_seconds)||settings.duration_seconds<4||settings.duration_seconds>30||!(input?['480p','720p','1080p']:['480p','720p']).includes(settings.resolution)||!['mp4','mov'].includes(settings.output_format)||typeof settings.generate_audio!=='boolean'||(!input&&!['16:9','4:3','1:1','3:4','9:16','21:9'].includes(settings.aspect_ratio)))throw Error('Unsupported video settings');return 'video'
 }
 if(provider==='openai'&&OPENAI_STILL_MODELS.includes(model)){
  exact(settings,['size','quality','background','output_format']);if(count<1||count>10||inputs.length||!['1024x1024','1024x1536','1536x1024'].includes(settings.size)||!['low','medium','high'].includes(settings.quality)||!['opaque','transparent'].includes(settings.background)||settings.output_format!=='png')throw Error('Unsupported OpenAI still settings');return 'image'
 }
 throw Error('This exact model has no verified media adapter')
}
export function requireSelectedSourceConsent(input,source,provider){
 exact(input,['kind','id','checksum','provider_consent']);exact(input.provider_consent,['provider','source_id','checksum','allow_transfer']);
 if(!source||!['design_asset_version','private_image_job','media_output','private_attachment'].includes(input.kind)||source.kind!==input.kind||source.id!==input.id||source.checksum!==input.checksum||!/^[a-f0-9]{64}$/.test(input.checksum)||input.provider_consent.provider!==provider||input.provider_consent.source_id!==input.id||input.provider_consent.checksum!==input.checksum||input.provider_consent.allow_transfer!==true)throw Error('Confirm transfer of this exact original image to the selected provider');
 return {kind:input.kind,id:input.id,checksum:input.checksum,provider_consent:{...input.provider_consent}}
}
