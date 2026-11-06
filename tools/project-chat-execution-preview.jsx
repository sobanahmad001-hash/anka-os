import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Execution} from '../src/components/ProjectWebsiteExecution.jsx'
import {createChatExecutionFixture} from './project-chat-execution-fixture.js'
import '../src/index.css'
const fixture=await createChatExecutionFixture();globalThis.__executionFixture=fixture
const dark=new URLSearchParams(location.search).get('theme')!=='light'
document.documentElement.style.cssText=dark?'--anka-canvas:#15131b;--anka-surface:#211d29;--anka-text:#eeeaf6;--anka-ink:#eeeaf6;--anka-line:#53475e;--anka-muted:#bab0c5;color-scheme:dark':'--anka-canvas:#faf9fc;--anka-surface:#fff;--anka-text:#282332;--anka-ink:#282332;--anka-line:#c4bace;--anka-muted:#61586c;color-scheme:light'
document.body.style.cssText='margin:0;background:var(--anka-canvas);color:var(--anka-text);font:14px system-ui'
function Preview(){const [key,setKey]=useState(0),[request,setRequest]=useState(fixture.props.request);return <main style={{maxWidth:840,margin:'auto',padding:16}}><h1>Project Chat · private website execution</h1><p>Synthetic local fixture. No live backend or provider.</p><Execution key={key} {...fixture.props} request={request} onRequestHandled={()=>setRequest(null)}/><button onClick={()=>setKey(v=>v+1)}>Reopen conversation</button><label style={{display:'grid'}}>Chat draft<textarea aria-label="Chat draft" defaultValue="Keep my next question"/></label></main>}
createRoot(document.getElementById('root')).render(<Preview/>);
