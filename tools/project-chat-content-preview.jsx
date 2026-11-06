import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import ProjectChatContentActions from '../src/components/ProjectChatContentActions.jsx'
import {createContentActionFixture} from './project-chat-content-fixture.js'
import '../src/index.css'
const fixture=createContentActionFixture();globalThis.__contentActionTest=fixture
const dark=new URLSearchParams(location.search).get('theme')!=='light'
document.documentElement.style.cssText=dark?'--anka-canvas:#15131b;--anka-ink:#eeeaf6;--anka-line:#393342;--anka-focus:#a491ff;color-scheme:dark':'--anka-canvas:#faf9fc;--anka-ink:#282332;--anka-line:#d9d3e2;--anka-focus:#6340c1;color-scheme:light'
document.body.style.cssText='margin:0;background:var(--anka-canvas);color:var(--anka-ink);font:14px system-ui'
function Preview(){const [request,setRequest]=useState(null),[key,setKey]=useState(0);return <main style={{maxWidth:760,margin:'auto',padding:16}}><h1>Project Chat</h1><p>Synthetic local preview · no provider or production actions</p><article><p>You: Write the homepage copy.</p><button onClick={()=>setRequest({id:crypto.randomUUID(),sourceMessageId:fixture.messages[0].id})}>Prepare Content</button></article><ProjectChatContentActions key={key} {...fixture} request={request} onRequestHandled={()=>setRequest(null)} timeoutMs={200}/><button onClick={()=>setKey(k=>k+1)}>Reopen conversation</button><label style={{display:'block',marginTop:20}}>Chat draft<textarea aria-label="Chat draft" defaultValue="Keep my next question" style={{display:'block',width:'100%'}}/></label></main>}
createRoot(document.getElementById('root')).render(<Preview/>);
