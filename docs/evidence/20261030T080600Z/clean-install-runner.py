"""Owned scratch clean-install proof. Never deletes the clone."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = Path('D:/Projects/Vibe_Coding/cpp-web-fps')
SCRATCH = Path('D:/Tools/Hermes/profiles/omh/cache/scratch')
CLONE = SCRATCH / 'cpp-web-fps-clean-20261030T080600Z'
OUT = ROOT / 'docs/evidence/20261030T080600Z'
EXPECTED = '7c392b2d262a1360348478af778f370602be01e2'
ENV = dict(os.environ, TEMP=str(SCRATCH), TMP=str(SCRATCH), TMPDIR=str(SCRATCH), EM_CONFIG='D:/Tools/emsdk/.emscripten', FORCE_COLOR='0')
ENV.pop('NO_COLOR', None)
NODE, GIT = shutil.which('node'), shutil.which('git')
NPM = Path(NODE).parent / 'node_modules/npm/bin/npm-cli.js'
receipt = {'schema':'clean_install_verification/v1', 'tested_revision':EXPECTED, 'source':str(ROOT), 'clone':str(CLONE), 'checks':[], 'passed':False, 'clone_retained':True}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def run(name, command, cwd):
    start = datetime.now(timezone.utc).isoformat()
    result = subprocess.run(list(map(str,command)), cwd=cwd, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    (OUT/f'clean-{name}.stdout.txt').write_bytes(result.stdout)
    (OUT/f'clean-{name}.stderr.txt').write_bytes(result.stderr)
    receipt['checks'].append({'name':name, 'command':list(map(str,command)), 'cwd':str(cwd), 'source':'clean local clone' if cwd==CLONE else 'parent checkout', 'started_at':start, 'finished_at':datetime.now(timezone.utc).isoformat(), 'exit_status':result.returncode, 'stdout_sha256':hashlib.sha256(result.stdout).hexdigest(), 'stderr_sha256':hashlib.sha256(result.stderr).hexdigest()})
    print(name, 'exit', result.returncode, flush=True)
    if result.returncode:
        print(result.stdout.decode('utf-8',errors='replace'))
        print(result.stderr.decode('utf-8',errors='replace'))
        raise RuntimeError(name)
    return result.stdout

try:
    assert CLONE.parent.resolve()==SCRATCH.resolve() and not CLONE.exists()
    assert NPM.is_file()
    assert subprocess.check_output([GIT,'rev-parse','HEAD'],cwd=ROOT,text=True).strip()==EXPECTED
    original=json.loads((OUT/'receipt.json').read_text(encoding='utf-8'))
    run('versions',[NODE,'-p','JSON.stringify({node:process.version,platform:process.platform,arch:process.arch})'],ROOT)
    version=run('compiler',[sys.executable,'D:/Tools/emsdk/upstream/emscripten/em++.py','--version'],ROOT)
    assert b'6.0.13' in version
    run('clone',[GIT,'clone','--no-hardlinks',ROOT,CLONE],ROOT)
    assert subprocess.check_output([GIT,'rev-parse','HEAD'],cwd=CLONE,text=True).strip()==EXPECTED
    assert subprocess.check_output([GIT,'status','--porcelain=v1'],cwd=CLONE)==b''
    receipt['source_files_checked']=len(original['source_sha256'])
    for rel,expected in original['source_sha256'].items():
        assert digest(ROOT/rel)==expected and digest(CLONE/rel)==expected,rel
    run('install',[NODE,NPM,'ci','--ignore-scripts','--no-audit','--no-fund'],CLONE)
    run('build',[sys.executable,'scripts/build.py'],CLONE)
    run('test',[NODE,NPM,'test'],CLONE)
    run('camera',[sys.executable,'scripts/build.py','--client-test'],CLONE)
    audit=run('audit',[NODE,NPM,'audit','--audit-level=high','--json'],CLONE)
    receipt['audit_vulnerabilities']=json.loads(audit)['metadata']['vulnerabilities']
    receipt['compared_outputs']={}
    for rel,expected in original['outputs'].items():
        actual=digest(CLONE/rel)
        receipt['compared_outputs'][rel]={'expected_sha256':expected,'clone_sha256':actual,'matches':actual==expected}
        assert actual==expected,rel
    receipt['static_source_byte_match']=all(digest(CLONE/rel)==digest(ROOT/rel) for rel in ['web/index.html','web/style.css','web/app.mjs','web/gpu.mjs','package-lock.json'])
    assert receipt['static_source_byte_match']
    receipt['final_clone_git_state']=subprocess.check_output([GIT,'status','--porcelain=v1','--untracked-files=all'],cwd=CLONE,text=True)
    assert receipt['final_clone_git_state']==''
    receipt['passed']=True
finally:
    receipt['python']=sys.version
    receipt['finished_at']=datetime.now(timezone.utc).isoformat()
    source=Path(__file__).read_bytes()
    (OUT/'clean-install-runner.py').write_bytes(source)
    receipt['runner_sha256']=hashlib.sha256(source).hexdigest()
    (OUT/'clean-install.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'passed':receipt['passed'],'clone':str(CLONE),'receipt':str(OUT/'clean-install.json')},ensure_ascii=False))
