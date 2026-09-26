import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import DepartmentChat from '../src/components/DepartmentChat.jsx'
import WorkshopChatWorkspace from '../src/components/WorkshopChatWorkspace.jsx'
import DesignChatTools from '../src/components/DesignChatTools.jsx'
import { engagement, setVideoFixture } from './design-workbench-fixture.js'
import '../src/index.css'

function Preview() {
  const [mode, setMode] = useState('chat'), [busy, setBusy] = useState(false), [theme, setTheme] = useState('system')
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => document.documentElement.dataset.theme = theme === 'system' ? media.matches ? 'dark' : 'light' : theme
    update(); media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [theme])
  useEffect(() => {
    if (!globalThis.MediaRecorder) return
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540
    const context = canvas.getContext('2d'), stream = canvas.captureStream(12), recorder = new MediaRecorder(stream), chunks = []
    let frame = 0, url = ''
    const draw = () => { context.fillStyle = '#ede6da'; context.fillRect(0,0,960,540); context.fillStyle='#746751'; context.fillRect(560+frame*2,80,220,380); context.fillStyle='#403728'; context.font='48px Georgia'; context.fillText('A quieter perspective.',60,260); context.font='20px Arial'; context.fillText('OFFLINE ANIMATION FIXTURE · NOT CLIENT MEDIA',60,460); frame++ }
    draw(); recorder.ondataavailable = event => chunks.push(event.data)
    recorder.onstop = () => { url = URL.createObjectURL(new Blob(chunks,{type:recorder.mimeType})); setVideoFixture(url); stream.getTracks().forEach(track => track.stop()) }
    recorder.start(); const interval = setInterval(draw,80); const timer = setTimeout(() => { clearInterval(interval); recorder.stop() },900)
    return () => { clearInterval(interval); clearTimeout(timer); if(recorder.state==='recording')recorder.stop(); if(url)URL.revokeObjectURL(url) }
  }, [])
  return <main className="workspace-page" style={{maxWidth:1600,margin:'auto'}}>
    <header style={{display:'flex',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}><div><p className="workspace-eyebrow">Anka Sphere / Design</p><h1 className="workspace-title">Design Workshop</h1><p className="workspace-description">Offline presentation preview · illustrative data · no network, provider calls or saved changes.</p></div><label>Appearance <select value={theme} onChange={event=>setTheme(event.target.value)} style={{background:'var(--anka-surface)',color:'var(--anka-ink)',padding:10}}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></header>
    <WorkshopChatWorkspace presentation="design" mode={mode} onModeChange={setMode} navigationBusy={busy} departmentName="Design" projectName="Studio identity · fixture" engagementName={engagement.name} onConversationSelect={()=>{}} conversationList={()=><aside aria-label="Workshop saved conversations" className="rounded-xl border p-4"><h3>Saved conversations · fixture</h3><p>Quiet editorial exploration</p><p>Private exploration · Only you</p><p>No live conversations loaded.</p></aside>}>
      {mode==='private' ? <section><h2>Private exploration · fixture</h2><p>This separate history has no project attached. Switch context explicitly to view project tools.</p></section> : <div className="design-workbench-grid"><DepartmentChat departmentId="design" engagement={engagement} presentation="workbench" presentationLabel="Offline chat fixture" hideConversationList allowArtifactDraft={false} externalNavigationBusy={busy} /><DesignChatTools presentation="workbench" engagement={engagement} onNavigationBusyChange={setBusy}/><details className="design-project-reference"><summary>Project references & review</summary><p>Illustrative context only. In the application, existing project links open the governed reference and review surfaces.</p></details></div>}
    </WorkshopChatWorkspace>
  </main>
}
createRoot(document.getElementById('root')).render(<RouterProvider router={createMemoryRouter([{path:'*',element:<Preview/>}])} />)
