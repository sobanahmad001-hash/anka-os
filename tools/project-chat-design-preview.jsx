import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {ChatDesignActions} from '../src/components/ProjectChatDesignActions.jsx'
import {createChatDesignFixture} from './project-chat-design-fixture.js'
import '../src/index.css'
const fixture=await createChatDesignFixture();globalThis.__designFixture=fixture
const dark=new URLSearchParams(location.search).get('theme')!=='light'
document.documentElement.style.cssText=dark?'--anka-canvas:#15131b;--anka-surface:#211d29;--anka-text:#eeeaf6;--anka-ink:#eeeaf6;--anka-line:#53475e;--anka-muted:#bab0c5;color-scheme:dark':'--anka-canvas:#faf9fc;--anka-surface:#fff;--anka-text:#282332;--anka-ink:#282332;--anka-line:#c4bace;--anka-muted:#61586c;color-scheme:light'
document.body.style.cssText='margin:0;background:var(--anka-canvas);color:var(--anka-text);font:14px system-ui'
function Preview(){const [request,setRequest]=useState(null),[key,setKey]=useState(0),[activity,setActivity]=useState({busy:false,dirty:false});return <main style={{maxWidth:840,margin:'auto',padding:16}}><h1>Project Chat</h1><p>Local synthetic preview · no production or provider calls</p><article><p>Approved Content handed off to Design.</p><button disabled={activity.busy||activity.dirty} onClick={()=>setRequest({...fixture.props.request,id:crypto.randomUUID()})}>Continue Design</button></article><ChatDesignActions key={key} {...fixture.props} request={request} onRequestHandled={()=>setRequest(null)} onStateChange={setActivity} timeoutMs={300}/><button onClick={()=>{setRequest(null);setKey(v=>v+1)}}>Reopen conversation</button><label style={{display:'grid',marginTop:20}}>Chat draft<textarea aria-label="Chat draft" defaultValue="Keep my next question" disabled={activity.busy||activity.dirty}/></label></main>}
createRoot(document.getElementById('root')).render(<Preview/>);
