import test from 'node:test'
import assert from 'node:assert/strict'
import {readdirSync,readFileSync,existsSync} from 'node:fs'

test('every ordinary Edge entrypoint installs the OAuth denial boundary',()=>{
  const root=new URL('../../supabase/functions/',import.meta.url)
  for(const directory of readdirSync(root)){
    if(directory==='hybrid-mcp')continue
    const path=new URL(`${directory}/index.ts`,root)
    if(!existsSync(path))continue
    const source=readFileSync(path,'utf8')
    // This manifest-pinned worker uses a machine secret for ticks, and every
    // manual action first calls a caller RPC rejected by the OAuth API guard.
    if(directory==='website-tracking'){
      assert.match(source,/website_tracking_machine_key/)
      for(const rpc of ['request_website_observation','configure_website_observations','configure_website_tracking','begin_project_reporting_verification'])assert.ok(source.includes(`user.rpc('${rpc}'`))
      continue
    }
    if(/Deno\.serve\(|^serve\(/m.test(source))assert.match(source,/rejectOAuthClients/,directory)
  }
})
