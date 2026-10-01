"""B7 identity-checked candidate catalog reconciliation. Definitions/ACL replay is rolled back."""
import argparse,hashlib,json,re,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--psql',required=True);p.add_argument('--evidence',required=True);a=p.parse_args();repo=Path(a.repo)
cmd=[a.psql,'-X','-w','-h','127.0.0.1','-p','55462','-U','postgres','-d','anka_b1_firstsend_20260930','-qAt','-v','ON_ERROR_STOP=1']
def run(sql):
 r=subprocess.run(cmd,input=sql,text=True,encoding='utf8',capture_output=True,timeout=90)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
identity=run("select current_database()||'|'||current_user||'|'||current_setting('data_directory');")
assert identity=='anka_b1_firstsend_20260930|postgres|G:/AnkaSphereN1LocalChecks/anka-schema-4453dd840a1a4131820f3d529a5378b9/data',identity
files=[p for p in sorted((repo/'supabase/migrations').glob('*.sql')) if p.name>='20260930141000_context_chat_atomic_first_send.sql']
assert len(files)==26,len(files)
pattern=re.compile(r'(?ims)^create(?: or replace)? function\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\([^)]*\).*?\bas\s+(\$[a-z_]*\$).*?\2;')
functions={};tables=set();acl=[];hashes={}
for path in files:
 source=path.read_text(encoding='utf8');hashes[path.name]=hashlib.sha256(path.read_bytes()).hexdigest()
 functions.update({m.group(1):m.group(0) for m in pattern.finditer(source)})
 tables.update(re.findall(r'(?im)^create table(?: if not exists)? public\.([a-z_][a-z0-9_]*)',source))
 acl.extend(re.findall(r'(?ims)^(?:grant|revoke)\s+.*?;',source))
assert len(functions)>80 and len(tables)>15,(len(functions),len(tables))
q=lambda value:"'"+value.replace("'","''")+"'"
names=','.join(q(v) for v in sorted(functions));tnames=','.join(q(v) for v in sorted(tables))
# Effective ACL tuples are sorted independently from internal ACL array ordering.
acl_expr="(select jsonb_agg(jsonb_build_array(coalesce(grantee.rolname,'PUBLIC'),x.privilege_type,x.is_grantable) order by coalesce(grantee.rolname,'PUBLIC'),x.privilege_type,x.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x left join pg_roles grantee on grantee.oid=x.grantee)"
state="select json_build_object('functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'definer',p.prosecdef,'config',p.proconfig,'acl',"+acl_expr+") order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname in ("+names+")),'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'acl',c.relacl::text,'columns',(select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) order by attnum) from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped),'constraints',(select jsonb_agg(pg_get_constraintdef(x.oid) order by x.conname) from pg_constraint x where x.conrelid=c.oid)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ("+tnames+")),'users',(select count(*) from auth.users));"
prior=json.loads(run(state));assert len(prior['tables'])==len(tables);assert all(t['rls'] for t in prior['tables'])
# Each complete migration/security/behavior/race receipt is reused; this proves the final integrated function and grant sources have not drifted.
replay='begin;set local lock_timeout=\'4s\';set local statement_timeout=\'70s\';'+''.join(re.sub(r'(?i)^create function', 'create or replace function',definition) for definition in functions.values())+''.join(acl)+state+'rollback;'
expected=json.loads(run(replay));assert expected==prior,'Installed candidate differs from final migration function/grant sources'
assert json.loads(run(state))==prior,'Rollback did not restore candidate catalog'
receipt={'databaseIdentity':identity,'migrationFiles':hashes,'migrationCount':len(files),'functionCount':len(prior['functions']),'tableCount':len(tables),'allOwnedTablesRls':True,'integratedFunctionsAndAclsMatchFinalSources':True,'catalogRestoredExactly':True,'usersBeforeAfter':prior['users'],'catalog':prior,'scope':'Owned isolated clone catalog only. Source/ACL replay rolled back; unchanged complete migration/security/behavior/observed-concurrency receipts reused. No production, user, fixture or provider writes.'}
p=Path(a.evidence);packet=json.loads(p.read_text(encoding='utf8'));packet.setdefault('releaseVerification',{})['installedLocalCandidate']=receipt;p.write_text(json.dumps(packet,indent=2)+'\n',encoding='utf8')
print(json.dumps({k:v for k,v in receipt.items() if k not in ['catalog','migrationFiles','scope']}))
