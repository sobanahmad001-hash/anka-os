import test from 'node:test'
import assert from 'node:assert/strict'
import {officialDesignImageSources} from './designAttachmentSources.js'
test('official input selection excludes foreign scope, archived, malformed and unsupported versions',()=>{
 const asset={id:'asset',organization_id:'org',engagement_id:'eng',brand_id:'brand',name:'Logo'}, version={id:'version',organization_id:'org',asset_id:'asset',mime_type:'image/png',storage_bucket:'design-generated-media',storage_path:'org/assets/asset/version/file.png',content_checksum:'a'.repeat(64),version_number:1};
 const w={engagement:{id:'eng',organization_id:'org',brand_id:'brand'},designAssets:[asset],designAssetVersions:[version]};
 assert.deepEqual(officialDesignImageSources(w,'org','eng').map(v=>[v.kind,v.id,v.checksum]),[['design_asset_version','version','a'.repeat(64)]]);
 for(const patch of [{organization_id:'other'},{engagement_id:'other'},{brand_id:'other'},{archived_at:'now'}])assert.equal(officialDesignImageSources({...w,designAssets:[{...asset,...patch}]},'org','eng').length,0);
 for(const patch of [{organization_id:'other'},{mime_type:'video/mp4'},{storage_bucket:'other'},{storage_path:'other/assets/file.png'},{content_checksum:null}])assert.equal(officialDesignImageSources({...w,designAssetVersions:[{...version,...patch}]},'org','eng').length,0);
 assert.deepEqual(officialDesignImageSources(w,'org',null),[]);assert.deepEqual(officialDesignImageSources(w,'other','eng'),[]);
})
