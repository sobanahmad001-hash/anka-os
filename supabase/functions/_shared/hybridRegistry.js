import {createSuppliedDraft} from './hybridDraft.js'
import {createProjectGetContextAdapter} from './projectGetContext.js'

// Availability describes this candidate, not deployment or production acceptance.
export const hybridCapabilities = Object.freeze([
  {name:'project.get_context',schemaVersion:1,authority:'caller-authenticated project read and existing positioning RPC authority',effects:[],providers:[],availability:'candidate',retry:'read again under current authority',audit:'exact approved source references, dates, gaps; excludes private chat',handler:'createProjectGetContextAdapter'},
  {name:'content.create_draft',schemaVersion:1,authority:'authenticated canonical Work-card write',effects:['save immutable Work content version','attach exact version to original card'],providers:[],availability:'candidate',retry:'same request_id and unchanged payload; conflict requires a new reviewed request',audit:'canonical content author, timestamp, request/version ID and card pin',handler:'save_hybrid_work_draft'},
  {name:'design.create_brief',schemaVersion:1,authority:'design-workshop existing scope and review guards',effects:['save creative brief version'],providers:[],availability:'descriptor_only',retry:'native operation key and expected revision',audit:'native creative brief version',handler:'design-workshop/save_creative_brief'},
  {name:'seo.research',schemaVersion:1,authority:'marketing-studio existing scope and research guards',effects:['save reviewed SEO research'],providers:['existing research provider configuration'],availability:'descriptor_only',retry:'native preview/save contract; hybrid adapter pending',audit:'native SEO evidence and provenance',handler:'marketing-studio/save_seo_research'},
  {name:'marketing.create_plan',schemaVersion:1,authority:'marketing-studio existing scope and review guards',effects:['save campaign plan draft'],providers:[],availability:'descriptor_only',retry:'native save contract; hybrid adapter pending',audit:'native campaign plan version',handler:'marketing-studio/save_campaign_plan'},
].map(Object.freeze))

export async function executeHybridCapability({client,name,input}) {
  if (name === 'project.get_context') return createProjectGetContextAdapter(client)(input)
  if (name !== 'content.create_draft') throw new Error('Capability unavailable in this candidate')
  return createSuppliedDraft(client,input)
}
