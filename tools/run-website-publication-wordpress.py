"""Run only the new isolated publication receiver fixture with cached official runtime assets."""
import argparse, json, os, shutil, subprocess, time
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--runtime',required=True)
p.add_argument('--cache-source',required=True)
p.add_argument('--out',required=True)
args=p.parse_args()
repo=Path(__file__).resolve().parent.parent
out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
home=out/'isolated-home';home.mkdir(exist_ok=True)
cache=home/'.wordpress-playground'
if not cache.exists():
    source=Path(args.cache_source).resolve()
    assert source.is_dir() and source.name=='.wordpress-playground'
    shutil.copytree(source,cache)
env={key:value for key,value in os.environ.items() if key.upper() in ['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT']}
env.update(USERPROFILE=str(home),HOME=str(home),LOCALAPPDATA=str(home/'Local'),APPDATA=str(home/'Roaming'))
Path(env['LOCALAPPDATA']).mkdir(exist_ok=True);Path(env['APPDATA']).mkdir(exist_ok=True)
command=['C:/Program Files/nodejs/node.exe','--max-old-space-size=512','--experimental-wasm-jspi',str(repo/'tools/check-website-publication-wordpress.mjs'),str(Path(args.runtime).resolve()),str(out)]
log_path=out/('runtime-'+str(time.time_ns())+'.log')
(out/'latest-log.txt').write_text(str(log_path),encoding='utf-8')
with log_path.open('w',encoding='utf-8') as log:
    result=subprocess.run(command,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
print(json.dumps({'exit_code':result.returncode,'log':str(log_path)}))
raise SystemExit(result.returncode)
