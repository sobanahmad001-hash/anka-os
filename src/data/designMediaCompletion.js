// Status/readback only: this watcher never creates or retries a generation.
export function watchOriginalMedia({state,canCheck,check,onLimit,schedule=setTimeout,cancel=clearTimeout}){
 let stopped=false,timer;
 const enqueue=()=>{if(!stopped&&!state.paused)timer=schedule(tick,Math.min(10000,2000+state.checks*500))};
 async function tick(){
  if(stopped||state.paused)return;
  if(!canCheck()){enqueue();return}
  if(state.checks>=60){state.paused=true;onLimit();return}
  state.checks++;
  try{await check()}catch{state.paused=true}
  enqueue();
 }
 enqueue();
 return()=>{stopped=true;cancel(timer)};
}
