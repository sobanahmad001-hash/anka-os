import {serializeWebsitePageOperations} from './projectWebsitePageContracts.js'
export const BULK_PAGE_STATES=Object.freeze(['planned','in_progress','review','ready'])
const fields=['planned_url','recorded_live_url','redirect_url','publication_state','template','work_item_id','implementation_notes','qa_evidence']
export function websiteBulkPatch(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!Object.keys(value).length||Object.keys(value).some(k=>!['template','publication_state'].includes(k)))throw new TypeError('Choose an explicit template or internal progress change')
 if(Object.hasOwn(value,'template')&&(typeof value.template!=='string'||!value.template.trim()||value.template!==value.template.trim()||value.template.length>160||/[\u0000-\u001f\u007f]/.test(value.template)))throw new TypeError('Enter a bounded template name')
 if(Object.hasOwn(value,'publication_state')&&!BULK_PAGE_STATES.includes(value.publication_state))throw new TypeError('Bulk progress cannot publish, retire or approve pages')
 return Object.freeze({...value})
}
export function prepareWebsiteBulkRow({page,context,architectureVersionId,patch}){
 const next=websiteBulkPatch(patch)
 if(!page?.page_id||context?.page?.id!==page.page_id||context.page.page_key!==page.source.page_key||context.reference?.artifact_version_id!==architectureVersionId||!Number.isSafeInteger(context.expected_revision)||context.expected_revision<0)throw new TypeError('The exact selected page/source/revision changed; review it again')
 const before=serializeWebsitePageOperations(Object.fromEntries(fields.map(k=>[k,context.operations?.[k]??(k==='publication_state'?'planned':['implementation_notes','qa_evidence'].includes(k)?'':null)])))
 const after=serializeWebsitePageOperations({...before,...next})
 return Object.freeze({page,context,before,operations:after,changed:Object.keys(next).some(k=>before[k]!==after[k]),fields:Object.keys(next)})
}
