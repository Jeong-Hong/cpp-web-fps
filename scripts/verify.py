"""Run real checks, preserve raw bytes and bind results to an input manifest."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path("D:/Tools/Hermes/profiles/omh/cache/scratch")

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def inputs():
    files = set()
    for directory in ["include", "core", "client", "server", "web", "tests", "scripts"]:
        for path in (ROOT / directory).rglob("*"):
            relative = path.relative_to(ROOT).as_posix()
            if path.is_file() and path.suffix in {".cpp", ".hpp", ".mjs", ".css", ".html", ".py", ".json"} and not relative.startswith("web/dist/") and "__pycache__" not in path.parts:
                files.add(path)
    for name in [".gitignore", ".gitattributes", "package.json", "package-lock.json", "playwright.config.mjs", "playwright.game.config.mjs", "START.cmd", "BUILD.cmd", "DESIGN.md", "README.md", "docs/PLAN.md", "docs/ACTIONS.md", "docs/PROTOCOL.md"]:
        files.add(ROOT / name)
    return {str(p.relative_to(ROOT).as_posix()): digest(p) for p in sorted(files)}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live-url", default="http://127.0.0.1:8088")
    args = parser.parse_args()
    if args.live_url != "http://127.0.0.1:8088":
        raise SystemExit("This retained verification is scoped to the owned loopback server on 8088")
    node, git = shutil.which("node"), shutil.which("git")
    if not node or not git:
        raise SystemExit("Node.js and Git are required")
    SCRATCH.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, TEMP=str(SCRATCH), TMP=str(SCRATCH), TMPDIR=str(SCRATCH), FORCE_COLOR="0")
    env.pop("NO_COLOR", None)
    started = time.time()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    before = inputs()
    revision = subprocess.check_output([git, "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    tree = subprocess.check_output([git, "status", "--porcelain=v1", "--untracked-files=all"], cwd=ROOT, text=True)
    out = ROOT / "docs/evidence" / run_id
    out.mkdir(parents=True, exist_ok=False)
    receipt = {"schema":"crossyard_verification/v1", "run_id":run_id, "repository":str(ROOT), "cwd":str(ROOT), "tested_revision":revision, "initial_git_state":tree, "python":sys.version, "source_sha256":before, "checks":[]}
    commands = [
        ("build", [sys.executable,"scripts/build.py"]),
        ("core", [sys.executable,"scripts/build.py","--test"]),
        ("camera", [sys.executable,"scripts/build.py","--client-test"]),
        ("node", [node,"--test","tests/*.test.mjs"]),
        ("browser", [node,"node_modules/@playwright/test/cli.js","test"]),
        ("game", [node,"node_modules/@playwright/test/cli.js","test","-c","playwright.game.config.mjs"]),
        ("live", [node,"scripts/live-smoke.mjs","--url",args.live_url]),
        ("launcher", [sys.executable,"scripts/launcher-smoke.py"]),
        ("diff", [git,"diff","--check"]),
    ]
    success = True
    for name, command in commands:
        beginning = datetime.now(timezone.utc).isoformat()
        print("CHECK",name,subprocess.list2cmdline(command),flush=True)
        try:
            process = subprocess.run(command,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=240)
            stdout,stderr,code,timed_out = process.stdout,process.stderr,process.returncode,False
        except subprocess.TimeoutExpired as error:
            stdout,stderr,code,timed_out = error.stdout or b"",error.stderr or b"",None,True
        (out / f"{name}.stdout.txt").write_bytes(stdout)
        (out / f"{name}.stderr.txt").write_bytes(stderr)
        record={"name":name,"command":command,"cwd":str(ROOT),"source":"this checkout","started_at":beginning,"finished_at":datetime.now(timezone.utc).isoformat(),"exit_status":code,"timed_out":timed_out,"stdout_sha256":hashlib.sha256(stdout).hexdigest(),"stderr_sha256":hashlib.sha256(stderr).hexdigest(),"scope":name}
        receipt["checks"].append(record)
        print(stdout.decode("utf-8",errors="replace"),end="")
        print(stderr.decode("utf-8",errors="replace"),end="",file=sys.stderr)
        if code != 0 or timed_out:
            success=False
            break
    receipt["inputs_unchanged"] = before == inputs()
    receipt["served_assets"] = {}
    if success:
        for name in ["index.html","style.css","app.mjs","gpu.mjs","dist/client.mjs","dist/client.wasm"]:
            target = "/" if name=="index.html" else "/"+name
            with urllib.request.urlopen(args.live_url+target,timeout=5) as response:
                served = hashlib.sha256(response.read()).hexdigest()
            local = digest(ROOT/"web"/name)
            receipt["served_assets"][name] = {"origin":args.live_url,"served_sha256":served,"local_sha256":local,"matches":served==local}
            assert served==local, name
    receipt["outputs"]={str(p.relative_to(ROOT).as_posix()):digest(p) for p in [ROOT/"build/sim.mjs",ROOT/"build/sim.wasm",ROOT/"web/dist/client.mjs",ROOT/"web/dist/client.wasm"] if p.is_file()}
    captures={}
    for path in sorted((ROOT/"work").glob("*.png")):
        if path.stat().st_mtime>=started:
            archive = out / "captures" / path.name
            archive.parent.mkdir(exist_ok=True)
            shutil.copy2(path, archive)
            data = archive.read_bytes()
            assert data[:8] == bytes([137,80,78,71,13,10,26,10])
            captures[path.relative_to(ROOT).as_posix()]={"sha256":digest(archive),"bytes":len(data),"width":int.from_bytes(data[16:20],"big"),"height":int.from_bytes(data[20:24],"big"),"archived_path":archive.relative_to(ROOT).as_posix()}
    receipt["captures"]=captures
    counts={}
    for check in receipt["checks"]:
        text=(out/(check["name"]+".stdout.txt")).read_text(encoding="utf-8",errors="replace")
        if check["name"]=="core":
            match=re.search(r"PASS (\d+) C\+\+ checks",text)
            if match:counts["core_checks"]=int(match.group(1))
        if check["name"]=="camera":
            match=re.search(r"PASS (\d+) C\+\+ camera",text)
            if match:counts["camera_checks"]=int(match.group(1))
        if check["name"]=="node":
            match=re.search(r"tests (\d+)",text)
            if match:counts["node_tests"]=int(match.group(1))
        if check["name"] in ["browser","game"]:
            match=re.search(r"(\d+) passed",text)
            if match:counts[check["name"]+"_tests"]=int(match.group(1))
    counts["browser_total"]=sum(counts.get(k,0) for k in ["browser_tests","game_tests"])
    receipt["counts"]=counts
    receipt["passed"]=success and receipt["inputs_unchanged"]
    target=out/"receipt.json"
    target.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"receipt":str(target),"passed":receipt["passed"],"counts":counts,"captures":len(captures)},ensure_ascii=False,indent=2))
    if not receipt["passed"]:
        raise SystemExit(1)

if __name__=="__main__":
    main()
