from pathlib import Path
from datetime import datetime,timezone
import sys,os,json,hashlib,subprocess,shutil
root=Path('D:/Projects/Vibe_Coding/cpp-web-fps')
node=shutil.which('node')
assert node
stage=sys.argv[1]
core=[sys.executable,'scripts/build.py','--test']
socket=[node,'--test','--test-name-pattern=REAL C\\+\\+/Wasm default engine','tests/transport-server.test.mjs']
hud=[node,'node_modules/@playwright/test/cli.js','test','-c','playwright.game.config.mjs','-g','real browser hit']
commands={'seq-red':[core,socket],'seq-green':[core,[sys.executable,'scripts/build.py','--core'],socket],'hud-red':[hud],'hud-green':[hud]}[stage]
out=root/'docs/evidence/review-fixes'
out.mkdir(exist_ok=True)
env=dict(os.environ,FORCE_COLOR='0',TEMP='D:/Tools/Hermes/profiles/omh/cache/scratch',TMP='D:/Tools/Hermes/profiles/omh/cache/scratch',TMPDIR='D:/Tools/Hermes/profiles/omh/cache/scratch')
env.pop('NO_COLOR',None)
record={'stage':stage,'revision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'dirty_tree':subprocess.check_output(['git','status','--porcelain=v1','--untracked-files=all'],cwd=root,text=True),'input_sha256':{rel:hashlib.sha256((root/rel).read_bytes()).hexdigest() for rel in ['include/arena.hpp','core/game.cpp','web/app.mjs','client/main.cpp','tests/core_tests.cpp','tests/transport-server.test.mjs','tests/e2e/game.spec.mjs']},'checks':[]}
for i,cmd in enumerate(commands):
 start=datetime.now(timezone.utc).isoformat()
 p=subprocess.run(cmd,cwd=root,env=env,capture_output=True,timeout=90)
 for name,data in [('stdout',p.stdout),('stderr',p.stderr)]: (out/f'{stage}-{i}.{name}.txt').write_bytes(data)
 record['checks'].append({'command':cmd,'cwd':str(root),'source':'this checkout','started_at':start,'finished_at':datetime.now(timezone.utc).isoformat(),'exit_status':p.returncode,'stdout_sha256':hashlib.sha256(p.stdout).hexdigest(),'stderr_sha256':hashlib.sha256(p.stderr).hexdigest()})
 print(stage,i,'exit',p.returncode)
 print((p.stdout+p.stderr).decode('utf-8',errors='replace'))
(out/f'{stage}.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
expected=1 if stage.endswith('-red') else 0
assert all(c['exit_status']==expected for c in record['checks'])
