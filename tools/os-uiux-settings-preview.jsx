import {createRoot} from 'react-dom/client'
import {createMemoryRouter,RouterProvider} from 'react-router-dom'
import Layout from '../src/components/Layout.jsx'
import Settings from '../src/apps/Settings.jsx'
import {ThemeProvider} from '../src/hooks/useTheme.jsx'
import {actor,organizationId} from './direct-chat-fixture.js'
import {browserStorage,writeThemePreference} from '../src/data/themePreference.js'
import '../src/index.css'
const membership={organizationId,organization:{id:organizationId,name:'Synthetic Anka'},role:'operations_admin',departmentId:'development',departmentIds:['development']}
globalThis.__uxSettings=true
globalThis.__directChatPreview={organization:{activeOrganizationId:organizationId,memberships:[membership],activeMembership:membership,selectionRequired:false,loading:false,scopeRevision:1,requestSignal:new AbortController().signal}}
writeThemePreference(browserStorage(),actor,new URLSearchParams(location.search).get('theme')||'light')
const router=createMemoryRouter([{element:<Layout/>,children:[{path:'*',element:<Settings/>}]}],{initialEntries:['/settings']})
createRoot(document.getElementById('root')).render(<ThemeProvider><RouterProvider router={router}/></ThemeProvider>)
