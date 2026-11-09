"""Build the shared C++ simulator and browser client with a local Emscripten SDK."""
from pathlib import Path
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory

from map_geometry import HEADER, SURFACE, bake_stairs

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path(os.environ.get("CROSSYARD_SCRATCH", "D:/Tools/Hermes/profiles/omh/cache/scratch"))
LOCAL_MAPS = ("cachette", "cafe", "library", "nyc", "smuggler")

def validate_geometry(path):
    data = path.read_bytes()
    magic, count = HEADER.unpack_from(data) if len(data) >= HEADER.size else (None, 0)
    if magic != b"CYA1" or not 0 < count <= 200000 or len(data) != HEADER.size + count * SURFACE.size:
        raise SystemExit(f"Invalid map geometry: {path}")
    if any(not all(map(math.isfinite, surface[:9])) for surface in SURFACE.iter_unpack(memoryview(data)[HEADER.size:])):
        raise SystemExit(f"Non-finite map geometry: {path}")
    return data

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true", help="build and execute deterministic C++ tests")
    parser.add_argument("--core", action="store_true", help="build only the authoritative simulator")
    parser.add_argument("--client-test", action="store_true", help="build and execute camera math tests")
    maps = parser.add_mutually_exclusive_group()
    maps.add_argument("--map", choices=LOCAL_MAPS, help="set the initial lobby selection")
    maps.add_argument("--cachette", dest="map", action="store_const", const="cachette", help="alias for --map cachette")
    args = parser.parse_args()
    sdk = Path(os.environ.get("EMSDK", "D:/Tools/emsdk"))
    compiler = sdk / "upstream/emscripten/em++.py"
    if not compiler.is_file():
        raise SystemExit(f"Emscripten not found: {compiler}. See README setup instructions.")
    SCRATCH.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, EM_CONFIG=str(sdk / ".emscripten"), EMSDK=str(sdk),
               TEMP=str(SCRATCH), TMP=str(SCRATCH), TMPDIR=str(SCRATCH))
    with TemporaryDirectory(prefix="map-geometry-", dir=SCRATCH) as working:
        build(args, compiler, env, Path(working))

def build(args, compiler, env, working):
    out = ROOT / "build"
    out.mkdir(exist_ok=True)
    common = [sys.executable, str(compiler), "-std=c++20", "-Wall", "-Wextra", "-Werror", "-I", str(ROOT / "include")]
    local_maps = [key for key in LOCAL_MAPS if (ROOT / "assets" / f"{key}.arena").is_file()]
    if args.map and args.map not in local_maps and not args.client_test:
        raise SystemExit(f"Map geometry missing: assets/{args.map}.arena")
    file_flags = ["-sFILESYSTEM=1"]
    if local_maps and not args.client_test:
        env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + env["PATH"]
        for key in local_maps:
            geometry = working / f"{key}.arena"
            source = validate_geometry(ROOT / "assets" / geometry.name)
            geometry.write_bytes(bake_stairs(source, key))
            file_flags += ["--embed-file", f"{geometry.as_posix()}@/maps/{geometry.name}"]
    core = ["core/game.cpp", "core/local_map.cpp"]
    def run(extra):
        command = common + extra
        print("BUILD", subprocess.list2cmdline(command), flush=True)
        subprocess.run(command, cwd=ROOT, env=env, check=True, timeout=240)
    if args.test or args.client_test:
        node = shutil.which("node")
        if not node:
            raise SystemExit("Node.js is required to run C++ Wasm tests")
        def run_test(name, sources, flags=()):
            target = out / f"{name}-tests.cjs"
            run(["-O1", "-g", *sources, *flags, "-sENVIRONMENT=node", "-sEXIT_RUNTIME=1", "-sASSERTIONS=2", "-o", str(target)])
            subprocess.run([node, str(target)], cwd=ROOT, env=env, check=True, timeout=45)
        if args.client_test:
            run_test("camera", ["-I", str(ROOT / "client"), "tests/client_math_tests.cpp"])
        else:
            run_test("core", [*core, "tests/core_tests.cpp"])
            if local_maps:
                run_test("local-map", [*core, "tests/local_map_tests.cpp"], [*file_flags, "-sALLOW_MEMORY_GROWTH=1"])
        return
    run(["-O2", *core, "core/bridge.cpp", "--no-entry", "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=node", "-sALLOW_MEMORY_GROWTH=1", *file_flags, "-sEXPORTED_RUNTIME_METHODS=" + json.dumps(["UTF8ToString"]), "-o", str(out / "sim.mjs")])
    if args.core:
        return
    webout = ROOT / "web/dist"
    webout.mkdir(parents=True, exist_ok=True)
    default_map = LOCAL_MAPS.index(args.map) + 1 if args.map else 0
    run(["-O2", *core, "client/main.cpp", f"-DARENA_DEFAULT_MAP={default_map}", "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=web", "-sALLOW_MEMORY_GROWTH=1", "-sMAXIMUM_MEMORY=268435456", *file_flags, "-sEXPORTED_RUNTIME_METHODS=" + json.dumps(["UTF8ToString"]), "-o", str(webout / "client.mjs")])

if __name__ == "__main__":
    main()
