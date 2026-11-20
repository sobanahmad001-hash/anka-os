// Resume native pages within one bounded wake; each page gets its own atomic claim.
export async function runTrackingBatch({run,now=Date.now,maxPages=8,budgetMs=40000}){
 const started=now();let result=null
 for(let count=0;count<maxPages&&now()-started<budgetMs;count++){
  result=await run()
  if(result?.state!=='queued'||result?.complete===true)break
 }
 return result
}
