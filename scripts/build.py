"""Build the shared C++ simulator and browser client with a local Emscripten SDK."""
from pathlib import Path
import argparse
import json
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path("D:/Tools/Hermes/profiles/omh/cache/scratch")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true", help="build and execute deterministic C++ tests")
    parser.add_argument("--core", action="store_true", help="build only the authoritative simulator")
    parser.add_argument("--client-test", action="store_true", help="build and execute camera math tests")
    args = parser.parse_args()
    sdk = Path(os.environ.get("EMSDK", "D:/Tools/emsdk"))
    compiler = sdk / "upstream/emscripten/em++.py"
    if not compiler.is_file():
        raise SystemExit(f"Emscripten not found: {compiler}. See README setup instructions.")
    SCRATCH.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, EM_CONFIG=str(sdk / ".emscripten"), EMSDK=str(sdk),
               TEMP=str(SCRATCH), TMP=str(SCRATCH), TMPDIR=str(SCRATCH))
    out = ROOT / "build"
    out.mkdir(exist_ok=True)
    common = [sys.executable, str(compiler), "-std=c++20", "-Wall", "-Wextra", "-Werror", "-I", str(ROOT / "include")]
    def run(extra):
        command = common + extra
        print("BUILD", subprocess.list2cmdline(command), flush=True)
        subprocess.run(command, cwd=ROOT, env=env, check=True, timeout=240)
    if args.test or args.client_test:
        target = out / ("camera-tests.cjs" if args.client_test else "core-tests.cjs")
        sources = ["-I", str(ROOT / "client"), "tests/client_math_tests.cpp"] if args.client_test else ["core/game.cpp", "tests/core_tests.cpp"]
        run(["-O1", "-g", *sources, "-sENVIRONMENT=node", "-sEXIT_RUNTIME=1", "-sASSERTIONS=2", "-o", str(target)])
        node = shutil.which("node")
        if not node:
            raise SystemExit("Node.js is required to run C++ Wasm tests")
        subprocess.run([node, str(target)], cwd=ROOT, env=env, check=True, timeout=45)
        return
    run(["-O2", "core/game.cpp", "core/bridge.cpp", "--no-entry", "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=node", "-sALLOW_MEMORY_GROWTH=1", "-sFILESYSTEM=0", "-sEXPORTED_RUNTIME_METHODS=" + json.dumps(["UTF8ToString"]), "-o", str(out / "sim.mjs")])
    if args.core:
        return
    webout = ROOT / "web/dist"
    webout.mkdir(parents=True, exist_ok=True)
    run(["-O2", "core/game.cpp", "client/main.cpp", "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=web", "-sALLOW_MEMORY_GROWTH=1", "-sMAXIMUM_MEMORY=268435456", "-sFILESYSTEM=0", "-sEXPORTED_RUNTIME_METHODS=" + json.dumps(["UTF8ToString"]), "-o", str(webout / "client.mjs")])

if __name__ == "__main__":
    main()
