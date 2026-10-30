"""Run one real TDD command and append immutable raw-byte evidence."""
from pathlib import Path
from datetime import datetime, timezone
import argparse,hashlib,json,os,subprocess,sys
root=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--lane',choices=['core','server','client'],required=True);p.add_argument('--label',required=True);p.add_argument('--expect',type=int,default=0);p.add_argument('--must-contain');p.add_argument('command',nargs=argparse.REMAINDER);a=p.parse_args()
assert a.label and all(c.isalnum() or c in '-_' for c in a.label)
command=a.command[1:] if a.command[:1]==['--'] else a.command
assert command
if command[0]=='python':command[0]=sys.executable
out=root/'.omh/artifacts/actions-tdd'/a.lane;out.mkdir(parents=True,exist_ok=True)
id=a.label+'-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
scope=['include/arena.hpp','core/game.cpp','core/bridge.cpp','tests/core_tests.cpp'] if a.lane=='core' else ['include/arena.hpp','client/main.cpp','server/protocol.mjs','server/engine.mjs','web/app.mjs','web/index.html','web/style.css',*[x.relative_to(root).as_posix() for x in (root/'tests').rglob('*.mjs')]]
inputs={n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in scope}
env=dict(os.environ,TEMP='D:/Tools/Hermes/profiles/omh/cache/scratch',TMP='D:/Tools/Hermes/profiles/omh/cache/scratch',TMPDIR='D:/Tools/Hermes/profiles/omh/cache/scratch',FORCE_COLOR='0');env.pop('NO_COLOR',None)
start=datetime.now(timezone.utc).isoformat();r=subprocess.run(command,cwd=root,env=env,capture_output=True,timeout=240)
stdout=out/(id+'.stdout.txt');stderr=out/(id+'.stderr.txt');stdout.write_bytes(r.stdout);stderr.write_bytes(r.stderr)
entry={'id':id,'label':a.label,'command':command,'cwd':str(root),'source':'this checkout','started_at':start,'finished_at':datetime.now(timezone.utc).isoformat(),'exit_status':r.returncode,'expected_exit':a.expect,'must_contain':a.must_contain,'input_sha256':inputs,'stdout':stdout.relative_to(root).as_posix(),'stderr':stderr.relative_to(root).as_posix(),'stdout_sha256':hashlib.sha256(r.stdout).hexdigest(),'stderr_sha256':hashlib.sha256(r.stderr).hexdigest()}
with (out/'journal.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(entry,ensure_ascii=False)+'\n')
sys.stdout.buffer.write(r.stdout);sys.stderr.buffer.write(r.stderr);sys.stdout.flush();sys.stderr.flush()
print(json.dumps({k:v for k,v in entry.items() if k!='input_sha256'},ensure_ascii=False))
assert r.returncode==a.expect, 'unexpected exit; inspect the preserved original logs'
if a.must_contain:assert a.must_contain in (r.stdout+r.stderr).decode('utf-8',errors='replace'), 'wrong failure reason'
