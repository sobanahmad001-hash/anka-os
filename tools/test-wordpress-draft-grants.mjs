import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const f=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.equal(f.origin,'http://127.0.0.1:55621');
const db='supabase_db_anka-hybrid-20261126';
const docker=(args,input)=>execFileSync('wsl.exe',['-d','Anka-Ubuntu','--','docker',...args],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000});
if (!process.argv[3]) assert.equal(docker(['inspect','-f','{{index .Config.Labels "com.supabase.cli.project"}}',db]).trim(),'anka-hybrid-20261126');
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
const connection=randomUUID(),target=randomUUID(),site=randomUUID();
const migration=fs.readFileSync(new URL('../supabase/migrations/20261127142408_hybrid_wordpress_draft_scope.sql',import.meta.url),'utf8');
const call=`public.hybrid_wordpress_draft_scope(${q(f.org)},${q(f.p1.project_id)},'engagement_work_item',${q(f.card)})`;
let checks=0;
const check=(expr,label)=>{checks++;return `do $$begin if not coalesce((${expr}),false) then raise exception ${q(label)};end if;end$$;\n`;};
const deny=(expr,label)=>{checks++;return `do $$begin begin perform ${expr};raise exception ${q(label)};exception when insufficient_privilege then null;end;end$$;\n`;};
let sql='begin;\n'+migration+`\nselect set_config('request.jwt.claims',jsonb_build_object('sub',${q(f.actor)},'role','hybrid_mcp','client_id',${q(f.client_id)},'session_id',(select id from auth.sessions where user_id=${q(f.actor)} and oauth_client_id=${q(f.client_id)} order by created_at desc limit 1))::text,true);
update private.hybrid_oauth_grants set revoked_at=null,can_save=true where user_id=${q(f.actor)} and client_id=${q(f.client_id)};
insert into public.integration_connections(id,organization_id,provider,display_name,base_url,status,created_by) values(${q(connection)},${q(f.org)},'wordpress','Synthetic draft fixture','https://staging.example.test','verified',${q(f.actor)});
insert into private.website_staging_targets(id,organization_id,project_id,engagement_id,connection_id,connection_revision,site_id,base_url,version_number,request_id,request_sha256,created_by)
select ${q(target)},${q(f.org)},${q(f.p1.project_id)},${q(f.p1.engagement_id)},id,updated_at,${q(site)},base_url,1,gen_random_uuid(),repeat('a',64),${q(f.actor)} from public.integration_connections where id=${q(connection)};
`;
sql+=deny(call,'existing Work-save consent must not grant WordPress');
sql+=`insert into private.hybrid_wordpress_grants(user_id,client_id,organization_id,project_id,card_kind,card_id,target_id,expires_at) values(${q(f.actor)},${q(f.client_id)},${q(f.org)},${q(f.p1.project_id)},'engagement_work_item',${q(f.card)},${q(target)},now()+interval '1 hour');\n`;
sql+=check(`${call}->>'site_id'=${q(site)}`,'exact target allowed');
sql+=deny(`public.hybrid_wordpress_draft_scope(${q(f.org)},${q(f.p2.project_id)},'engagement_work_item',${q(f.card)})`,'cross project denied');
sql+=`update private.hybrid_wordpress_grants set revoked_at=now();\n`+deny(call,'revoked external grant denied');
sql+=`update private.hybrid_wordpress_grants set revoked_at=null,expires_at=now()-interval '1 second';\n`+deny(call,'expired external grant denied');
sql+=`update private.hybrid_wordpress_grants set expires_at=now()+interval '1 hour';update private.hybrid_oauth_grants set can_save=false where user_id=${q(f.actor)};\n`+deny(call,'read-only OAuth denied');
sql+=`update private.hybrid_oauth_grants set can_save=true,revoked_at=now() where user_id=${q(f.actor)};\n`+deny(call,'revoked OAuth denied');
sql+=`update private.hybrid_oauth_grants set revoked_at=null where user_id=${q(f.actor)};update public.integration_connections set status='disabled' where id=${q(connection)};\n`+deny(call,'disabled connection denied');
sql+=check(`not has_table_privilege('hybrid_mcp','private.hybrid_wordpress_grants','select') and not has_table_privilege('authenticated','private.hybrid_wordpress_grants','insert')`,'no direct grant access');
sql+='rollback;';
if (process.argv[3]) { fs.writeFileSync(process.argv[3],sql); console.log('Wrote synthetic transactional fixture; no credentials included'); process.exit(0); }
try {docker(['exec','-i',db,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],sql);} catch(e) {console.error(e.stderr?.toString());process.exit(1);}
console.log(JSON.stringify({checks,passed:true,rolledBack:true,productionWrites:false}));
