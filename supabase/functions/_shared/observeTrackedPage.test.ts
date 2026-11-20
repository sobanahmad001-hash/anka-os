import {observeTrackedPage} from './observeTrackedPage.ts'
const response=(status=200,text='',location='',type='text/html')=>({status,text,location,type})
Deno.test('robots exclusions prevent the page request',async()=>{
 const calls:string[]=[]
 const snapshot=await observeTrackedPage('https://example.com/private',{pin:async()=> '93.184.216.34',read:async(url)=>{calls.push(url.pathname);return response(200,'User-agent: *\nDisallow: /private')}})
 if(snapshot.state!=='robots_excluded'||calls.join()!=='/robots.txt')throw Error('Excluded page fetched')
})
Deno.test('redirects remain on the approved origin and retain header directives',async()=>{
 const calls:string[]=[]
 const snapshot=await observeTrackedPage('https://example.com/old',{pin:async()=> '93.184.216.34',read:async(url)=>{
  calls.push(url.pathname)
  if(url.pathname==='/robots.txt')return response(404)
  if(url.pathname==='/old')return response(301,'','/new')
  return {...response(200,'<main><h1>New page</h1></main>'),robotsHeader:'noindex'}
 }})
 if(snapshot.state!=='observed'||!('robotsHeader' in snapshot)||snapshot.robotsHeader!=='noindex'||calls.join()!=='/robots.txt,/old,/new')throw Error('Observation lost redirect or directives')
 const denied=await observeTrackedPage('https://example.com/',{pin:async()=> '93.184.216.34',read:async(url)=>url.pathname==='/robots.txt'?response(404):response(301,'','https://other.example/')})
 if(denied.state!=='http_error')throw Error('Foreign redirect accepted')
})
Deno.test('read and DNS failures remain unknown rather than empty successful pages',async()=>{
 const snapshot=await observeTrackedPage('https://example.com/',{pin:async()=>{throw Error('DNS failure')},read:async()=>response()})
 if(snapshot.state!=='read_failed'||'content' in snapshot)throw Error('Failure fabricated content')
})
