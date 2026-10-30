from pathlib import Path
from datetime import datetime,timezone
import os,sys,subprocess,json,hashlib,shutil
root=Path('D:/Projects/Vibe_Coding/cpp-web-fps')
out=root/'docs/evidence/20261030T084415Z/primary-origin'
out.mkdir(exist_ok=False)
node=shutil.which('node')
assert node
command=[node,'node_modules/@playwright/test/cli.js','test','-c','.omh/artifacts/direct.config.mjs','--grep','actual C']
env=dict(os.environ,FORCE_COLOR='0',TEMP='D:/Tools/Hermes/profiles/omh/cache/scratch',TMP='D:/Tools/Hermes/profiles/omh/cache/scratch',TMPDIR='D:/Tools/Hermes/profiles/omh/cache/scratch')
env.pop('NO_COLOR',None)
start=datetime.now(timezone.utc).isoformat()
p=subprocess.run(command,cwd=root,env=env,capture_output=True,timeout=90)
(out/'stdout.txt').write_bytes(p.stdout);(out/'stderr.txt').write_bytes(p.stderr)
record={'schema':'primary_origin_controls/v1','origin':'http://127.0.0.1:8088','tested_revision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'command':command,'cwd':str(root),'source':'this checkout, owned primary loopback server','started_at':start,'finished_at':datetime.now(timezone.utc).isoformat(),'exit_status':p.returncode,'stdout_sha256':hashlib.sha256(p.stdout).hexdigest(),'stderr_sha256':hashlib.sha256(p.stderr).hexdigest(),'browser_scope':'fresh headless Chromium contexts, not physical hand input or an existing user profile','config_sha256':hashlib.sha256((root/'.omh/artifacts/direct.config.mjs').read_bytes()).hexdigest()}
if p.returncode==0:
    captures={}
    (out/'captures').mkdir()
    for scenario in ['reduce','no-preference','reduce-webgl']:
        for state in ['firing','play','menu']:
            name=f'{state}-{scenario}.png';src=root/'work'/name;dst=out/'captures'/name
            shutil.copy2(src,dst);captures[name]=hashlib.sha256(dst.read_bytes()).hexdigest()
    record['captures']=captures
for source,name in [(root/'.omh/artifacts/direct.config.mjs','direct.config.mjs'),(Path(__file__),'runner.py')]:shutil.copy2(source,out/name)
(out/'receipt.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(p.stdout.decode('utf-8',errors='replace'));print(p.stderr.decode('utf-8',errors='replace'))
raise SystemExit(p.returncode)
