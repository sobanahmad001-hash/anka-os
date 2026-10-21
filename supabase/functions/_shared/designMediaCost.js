// Shared display/server validation. Only a server-issued immutable quote is trusted.
// Request identity includes scope, exact brief and input versions, model, settings and output count.
export const MEDIA_ONE_CLICK_LIMIT_MICROUSD = 2_000_000
function canonical(value) {
 if(value===null||typeof value!=='object')return JSON.stringify(value)
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}'
}
export function mediaRequestIdentity(request) {
 if(!request||typeof request!=='object'||Array.isArray(request))throw Error('Exact media request required')
 const keys=['organization_id','context','creative_brief_version_id','connector_connection_id','provider','model_id','settings','output_count','input_versions','prompt_checksum']
 if(Object.keys(request).some(key=>!keys.includes(key))||keys.some(key=>request[key]===undefined))throw Error('Incomplete exact media request')
 if(!Number.isSafeInteger(request.output_count)||request.output_count<1||request.output_count>100
  ||!['openai','higgsfield'].includes(request.provider)||typeof request.model_id!=='string'||!request.model_id.trim()
  ||!Array.isArray(request.input_versions)||!request.settings||typeof request.settings!=='object'||Array.isArray(request.settings)
  ||typeof request.prompt_checksum!=='string'||!/^[a-f0-9]{64}$/.test(request.prompt_checksum))throw Error('Unsupported exact media request')
 return canonical(request)
}
export function requireMediaQuote(request,quote,now=Date.now()) {
 const identity=mediaRequestIdentity(request)
 const estimated=quote?.price_basis==='estimated', reviewed=estimated?quote?.reviewed_at:quote?.verified_at
 if(quote?.price_basis!==undefined&&!['estimated','verified'].includes(quote.price_basis))throw Error('Unknown price basis')
 if(!quote||typeof quote.id!=='string'||!quote.id||quote.currency!=='USD'
  ||mediaRequestIdentity(quote.request)!==identity
  ||!Number.isSafeInteger(quote.unit_max_charge_microusd)||quote.unit_max_charge_microusd<1
  ||!Number.isSafeInteger(quote.total_max_charge_microusd)||quote.total_max_charge_microusd<1
  ||quote.total_max_charge_microusd!==quote.unit_max_charge_microusd*request.output_count
  ||!Number.isFinite(Date.parse(reviewed))||Date.parse(reviewed)>now
  ||!Number.isFinite(Date.parse(quote.valid_until))||Date.parse(quote.valid_until)<=now
  ||Date.parse(quote.valid_until)-Date.parse(reviewed)>86400000
  ||typeof quote.request_checksum!=='string'||!/^[a-f0-9]{64}$/.test(quote.request_checksum))throw Error('Fresh verified total quote required for this exact request')
 return {estimated,quoteId:quote.id,requestChecksum:quote.request_checksum,totalMicrousd:quote.total_max_charge_microusd,requiresConfirmation:quote.total_max_charge_microusd>MEDIA_ONE_CLICK_LIMIT_MICROUSD}
}
export function requireMediaGenerationAcceptance(request,quote,acceptance,now=Date.now()) {
 const cost=requireMediaQuote(request,quote,now)
 if(acceptance?.generate!==true||acceptance.quote_id!==cost.quoteId||acceptance.request_checksum!==cost.requestChecksum
  ||acceptance.total_max_charge_microusd!==cost.totalMicrousd
  ||(cost.estimated&&acceptance.accept_estimated_price_risk!==true)
  ||(cost.requiresConfirmation&&acceptance.confirm_above_threshold!==true))throw Error('Confirm this exact media request before charging')
 return cost
}
