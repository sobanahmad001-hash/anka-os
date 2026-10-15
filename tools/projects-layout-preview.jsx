import React from 'react'
import {createRoot} from 'react-dom/client'
import Panel from '../src/apps/ProjectServiceScopePanel.jsx'
window.projectLayoutCalls=[]
createRoot(document.getElementById('root')).render(<main className="workspace-page"><div className="workspace-container"><h1 className="workspace-title">Launch · synthetic project</h1><Panel project={{id:'project',status:'active'}} organizationId="org" membership={{role:'operations_admin',organizationId:'org'}} scopeRevision={1} requestSignal={new AbortController().signal} /></div></main>)
