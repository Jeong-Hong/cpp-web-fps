"""Exercise START.cmd's serving branch in an owned ephemeral process tree (Windows)."""
from pathlib import Path
import json
import os
import queue
import re
import subprocess
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path("D:/Tools/Hermes/profiles/omh/cache/scratch")

def main():
    SCRATCH.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, TEMP=str(SCRATCH), TMP=str(SCRATCH), TMPDIR=str(SCRATCH))
    child = subprocess.Popen(["cmd.exe", "/d", "/c", "START.cmd --port 0"], cwd=ROOT,
                             env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT)
    lines = queue.Queue()
    stream = child.stdout
    assert stream is not None
    def read():
        for line in iter(stream.readline, b""):
            lines.put(line.decode("utf-8", errors="replace").strip())
        lines.put(None)
    thread = threading.Thread(target=read, daemon=True)
    thread.start()
    url = None
    transcript = []
    try:
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            line = lines.get(timeout=max(.1, deadline-time.monotonic()))
            if line is None:
                raise RuntimeError("Launcher exited before readiness")
            transcript.append(line)
            match = re.search(r"CROSSYARD (http://127[.]0[.]0[.]1:[0-9]+)", line)
            if match:
                url = match.group(1)
                break
        if not url:
            raise RuntimeError("Launcher did not publish its owned address")
        with urllib.request.urlopen(url + "/health", timeout=4) as response:
            health = json.load(response)
        assert health == {"ok": True, "engine": "C++/Wasm", "rooms": 0, "clients": 0, "tickRate": 60}, health
    finally:
        if child.poll() is None:
            subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"], check=True,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=8)
        child.wait(timeout=5)
        thread.join(timeout=2)
    port = url.rsplit(":", 1)[1]
    rows = subprocess.check_output(["netstat", "-ano"], text=True, errors="replace").splitlines()
    listeners = [r.strip() for r in rows if len(r.split()) > 3 and r.split()[1].rsplit(":", 1)[-1] == port and "LISTENING" in r]
    assert not listeners, listeners
    print(json.dumps({"kind": "observed_START_cmd_serving_branch", "url": url,
                      "health": health, "owned_process_tree_stopped": True,
                      "listener_absent_after_cleanup": True, "launcher_output": transcript}, indent=2))

if __name__ == "__main__":
    main()
