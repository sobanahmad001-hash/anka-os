"""Verify reviewed adapter source/semantics fingerprints. Never writes or activates anything."""
import hashlib,json
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
m=json.loads((repo/'supabase/functions/_shared/reportingGoogleManifests.json').read_text(encoding='utf8'))
for name,expected in m['implementationFiles'].items():
 actual=hashlib.sha256((repo/name).read_text(encoding='utf8').replace('\r\n','\n').encode()).hexdigest()
 assert actual==expected,'Adapter source manifest changed: '+name
for entry in m['adapters']:
 contract={k:v for k,v in entry.items() if k!='manifestSha256'}
 actual=hashlib.sha256(json.dumps({'contract':contract,'implementationFiles':m['implementationFiles']},sort_keys=True,separators=(',',':')).encode()).hexdigest()
 assert actual==entry['manifestSha256'],entry['sourceContract']
 sql=(repo/'supabase/migrations/20261002006000_reporting_google_adapter_registry.sql').read_text(encoding='utf8')
 assert actual in sql and entry['sourceContract'] in sql
print('Exact Google adapter manifests PASS',len(m['adapters']),'source/metric contracts; no activation')
