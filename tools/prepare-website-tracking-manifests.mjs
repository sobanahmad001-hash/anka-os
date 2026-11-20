import fs from 'node:fs'
import crypto from 'node:crypto'
import {dailyGscContract} from '../supabase/functions/_shared/dailyGscAdapter.js'
const registry='supabase/migrations/20261119133820_website_tracking_adapter_registry.sql'
const hash=s=>crypto.createHash('sha256').update(s).digest('hex')
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x
const digest=x=>hash(JSON.stringify(canonical(x)))
const hashes=files=>Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(f,'utf8').replaceAll('\r\n','\n'))]))
const quote=x=>"'"+String(x).replaceAll("'","''")+"'"
let sql='-- Reviewed implementation registrations. Existing adapters remain disabled; no project schedule is enabled.\n'
function register(a,enabled=false){
 sql+=`insert into private.reporting_refresh_adapters(source_contract,provider,resource_kind,manifest_sha256,metric_definitions,enabled) values(${[a.sourceContract,a.provider,a.resourceKind,a.manifestSha256,JSON.stringify(a.metricDefinitions)].map(quote).join(',')},${enabled});\n`
 if(a.maxRequestsPerDispatch)sql+=`insert into private.reporting_http_costs(source_contract,manifest_sha256,request_budget) values(${quote(a.sourceContract)},${quote(a.manifestSha256)},2);\n`
}
for(const [file,key] of [['reportingGoogleManifests.json','adapters'],['reportingFacebookManifest.json','adapter']]){
 const path='supabase/functions/_shared/'+file,m=JSON.parse(fs.readFileSync(path,'utf8'))
 m.implementationFiles=hashes(Object.keys(m.implementationFiles));m.registryMigration=registry
 for(const a of key==='adapters'?m.adapters:[m.adapter]){
  const contract=Object.fromEntries(Object.entries(a).filter(([key])=>key!=='manifestSha256'))
  a.manifestSha256=digest({contract,implementationFiles:m.implementationFiles})
  register(a)
 }
 fs.writeFileSync(path,JSON.stringify(m,null,2)+'\n')
}
const shared=['dailyGscAdapter.js','dailyGscCredentials.ts','reportingGoogleAdapters.js','reportingRefreshWorker.js','reportingVerificationWorker.js','reportingIngestion.js','reportingRefreshPolicy.js','googleOAuthTokens.ts','websiteTrackingBatch.js','observeTrackedPage.ts','websiteObservedChanges.js','websiteStagingContracts.js']
const implementationFiles=hashes([...shared.map(f=>'supabase/functions/_shared/'+f),'supabase/functions/website-tracking/index.ts','supabase/functions/website-discovery/discover.js','supabase/functions/website-discovery/publicSite.ts'])
const manifest={schemaVersion:1,registryMigration:registry,implementationFiles,adapter:{...dailyGscContract,manifestSha256:digest({contract:dailyGscContract,implementationFiles})}}
register(manifest.adapter,true)
fs.writeFileSync('supabase/functions/website-tracking/manifest.json',JSON.stringify(manifest,null,2)+'\n')
fs.writeFileSync(registry,sql)
