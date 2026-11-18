export function eligibleKeyword(row){
 return !row.roles&&row.state==='suggested'&&row.impressions!==null
}
export async function submitKeywordReview({review,scope,rpc,save,shouldContinue=()=>true}){
 for(const row of review.rows){
  if(!shouldContinue())break
  if(row.status==='saved'||row.status==='conflict')continue
  try{
   if(!row.request){
    const page=await rpc('website_page_index',{...scope,p_page:review.page})
    const current=page.items.find(p=>p.id===review.page)
    if(!current)throw Error('Page unavailable. Reopen the review.')
    row.request={...scope,p_page:review.page,p_query:row.query,p_state:review.action,p_request:crypto.randomUUID(),
     p_decision_revision:row.revision,p_page_revision:current.revision,
     p_role:review.action==='selected'?'supporting':null,p_intent:review.action==='selected'?row.intent.trim():null,
     p_locale:review.action==='selected'?row.locale.trim():null}
    save(review)
   }
   if(!shouldContinue())break
   await rpc('decide_website_keyword',row.request)
   row.status='saved';row.error=''
  }catch(error){
   row.status=['40001','P0001','42501','P0002','22023','23505'].includes(error.code)?'conflict':'retry'
   row.error=error.message||'Save not confirmed. Retry the same request.'
  }
  save(review)
 }
 return review
}
