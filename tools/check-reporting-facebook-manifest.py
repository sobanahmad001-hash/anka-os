"""Read-only exact Facebook implementation/metric/request-cost registry verification."""
import hashlib,json
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
m=json.loads((repo/'supabase/functions/_shared/reportingFacebookManifest.json').read_text(encoding='utf8'))
for name,expected in m['implementationFiles'].items():
 assert hashlib.sha256((repo/name).read_text(encoding='utf8').replace('\r\n','\n').encode()).hexdigest()==expected,name
entry=m['adapter'];contract={k:v for k,v in entry.items() if k!='manifestSha256'}
actual=hashlib.sha256(json.dumps({'contract':contract,'implementationFiles':m['implementationFiles']},sort_keys=True,separators=(',',':')).encode()).hexdigest()
assert actual==entry['manifestSha256'] and entry['maxRequestsPerDispatch']==2
sql=(repo/'supabase/migrations/20261002134957_reporting_facebook_adapter_proof.sql').read_text(encoding='utf8')
assert sql.count(actual)==2 and sql.count(entry['sourceContract'])==2
assert json.dumps(entry['metricDefinitions'],separators=(',',':')) in sql
assert "',false);" in sql and "',2);" in sql
print('Exact disabled Facebook implementation/metric/two-request-cost manifest PASS; no activation')
