const id=n=>'b0000000-0000-4000-8000-'+String(n).padStart(12,'0')
export function publicationFixture(scope){
 const target={id:id(1),site_id:id(2),base_url:'https://publication.example.test',version_number:1,current:true},choice={qa_receipt_id:id(3),approval_id:id(4),page_id:id(5),page_key:'home',created_at:'2026-10-29 · exact saved version'},history=[],counts={publication:0,rollback:0,recover:0,review:0},rows=[{post_id:10,revision:11,path:'/about',sha256:'a'.repeat(64),managed_page_id:null,post_type:'page',post_status:'publish'}]
 const inventory={site_id:target.site_id,origin:target.base_url,environment:'production',head:null,inventory_sha256:'b'.repeat(64),theme_sha256:'c'.repeat(64),complete:true,posts:rows},snapshot={scope,target:{target_id:target.id,origin:target.base_url,site_id:target.site_id},inspection:inventory,pages:[{page_id:choice.page_id,page_key:'home',path:'/home',operation:'create',qa:choice,release_approval:{id:choice.approval_id,decision:'approved'},package_sha256:'d'.repeat(64)}]}
 let last=null
 return{counts,history,target,choice,repository:{
  workspace:async()=>({...scope,connections:[],targets:[target],choices:[choice],history:[...history]}),
  inventory:async()=>({...scope,target_id:target.id,inventory:structuredClone(inventory)}),
  review:async(_scope,_target,pages,theme)=>{counts.review++;return{kind:'publication',review_id:id(6),review_sha256:'e'.repeat(64),snapshot:{...structuredClone(snapshot),theme_change:theme,selected_page_sources:pages}}},
  reviewRollback:async(_scope,requestId,theme)=>{counts.review++;return{kind:'rollback',review_id:id(7),review_sha256:'f'.repeat(64),snapshot:{...structuredClone(snapshot),retained:{published_head:requestId,backup_snapshot_sha256:'a'.repeat(64),posts:[{page_id:choice.page_id,post_id:20,revision:21,sha256:'a'.repeat(64),operation:'create'}]},theme_change:theme}}},
  execute:async(_scope,review,requestId)=>{counts[review.kind]++;const row={...scope,request_id:requestId,status:'succeeded',projection_status:'applied',kind:review.kind,target_id:target.id,base_url:target.base_url,created_at:'2026-10-29 · retained exact operation'};last=row;history.unshift(row);inventory.head=requestId;if(review.kind==='publication')throw Error('Synthetic lost reply: recover the original request');return row},
  recover:async()=>{counts.recover++;return last},
 }}
}
