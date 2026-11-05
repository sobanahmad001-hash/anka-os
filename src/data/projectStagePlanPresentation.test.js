import test from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'

test('stage presentation withholds invented completion and preserves supplied evidence',async t=>{
 const vite=await createServer({server:{middlewareMode:true},logLevel:'silent'})
 t.after(()=>vite.close())
 const {default:StagePlan}=await vite.ssrLoadModule('/src/components/ProjectStagePlan.jsx')
 const render=plan=>renderToStaticMarkup(createElement(StagePlan,{plan,onContinue(){}}))
 const empty=render(null)
 assert.match(empty,/No mapped stage plan yet/)
 assert.match(empty,/Not configured/)
 assert.doesNotMatch(empty,/>Done</)
 assert.doesNotMatch(empty,/of \d+ required/)
 const stage={id:'content',title:'Page content',configured:true,status:'in_review',needsUpdate:true,progress:{completed:8,total:12,label:'pages approved'},outputs:[{id:'v3',title:'Homepage content',versionLabel:'Version 3',path:'/sphere/workspace/projects/project?tab=outputs'}],items:[{id:'home',title:'Homepage',configured:true,status:'done',intent:'Commercial',keywords:['project planning']},{id:'about',title:'About',configured:true,status:'in_progress'}]}
 const plan={tracks:[{id:'website',title:'Website',stages:[stage]}]}
 const unavailable=render({...plan,state:'unavailable'})
 assert.match(unavailable,/Saved progress is unavailable/)
 assert.doesNotMatch(unavailable,/8 of 12|>Done</)
 const unbound=render({tracks:[{id:'website',title:'Website',stages:[{...stage,configured:false}]}]})
 assert.doesNotMatch(unbound,/8 of 12/)
 const html=render(plan)
 assert.match(html,/8 of 12 pages approved/)
 assert.match(html,/Needs update/)
 assert.match(html,/Version 3/)
 assert.match(html,/Commercial/)
 assert.match(html,/project planning/)
 assert.match(html,/>Done</)
 assert.match(html,/>In progress</)
 assert.match(html,/href="\/sphere\/workspace\/projects\/project\?tab=outputs"/)
 const unknown=render({tracks:[{id:'website',title:'Website',stages:[{...stage,status:'complete_guess',needsUpdate:false,progress:{completed:8,total:0},outputs:[{id:'unsafe',title:'Output',path:'//external.invalid'}],items:[]}]}]})
 assert.match(unknown,/Status unavailable/)
 assert.doesNotMatch(unknown,/8 of 0|href=/)
})
