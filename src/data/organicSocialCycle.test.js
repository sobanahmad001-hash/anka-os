import test from 'node:test'
import assert from 'node:assert/strict'
import { organicSocialCycle } from './organicSocialCycle.js'
import { readMarketingWorkPages } from './manualMarketingWork.js'

const card = { project_id:'project',work_item_id:'work',original_month:'2026-12-01',kind:'reel',
  planned_date:'2027-01-01',scheduled_date:'2027-01-02',published_date:'2027-01-03' }
const projectMonth = (month,cards=[card])=>organicSocialCycle({projectId:'project',month,cards,goals:{reel:4,post:0}})

test('a carried reel retains its commitment across the year boundary and counts one actual delivery',()=>{
  const december=projectMonth('2026-12')
  assert.deepEqual(december.counts.reel,{goal:4,committed:1,planned:0,scheduled:0,delivered:0})
  assert.equal(december.board[0],card)
  const january=projectMonth('2027-01')
  assert.deepEqual(january.counts.reel,{goal:4,committed:0,planned:1,scheduled:1,delivered:1})
  assert.deepEqual([...january.calendar.keys()],['2027-01-03'])
  assert.equal(january.calendar.get('2027-01-03')[0],january.board[0])
  assert.equal(january.counts.post.goal,0)
})
test('a duplicate or foreign Work cannot inflate counts',()=>{
  assert.throws(()=>projectMonth('2027-01',[card,card]),/inconsistent/)
  assert.throws(()=>projectMonth('2027-01',[{...card,project_id:'other'}]),/inconsistent/)
})
test('large month reads advance the stable id cursor across full pages',async()=>{
  const records=Array.from({length:501},(_,i)=>({id:String(i).padStart(4,'0')}))
  const calls=[]
  const query=()=>({
    after:'',order(field){assert.equal(field,'id');return this},limit(n){this.size=n;return this},
    gt(field,value){assert.equal(field,'id');this.after=value;return this},
    then(resolve){calls.push(this.after);resolve({data:records.filter(r=>r.id>this.after).slice(0,this.size)})}
  })
  assert.deepEqual(await readMarketingWorkPages(query),records)
  assert.deepEqual(calls,['','0249','0499'])
})
