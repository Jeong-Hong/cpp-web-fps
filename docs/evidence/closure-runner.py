"""Read-only closure checks; optional new companion result, no test reruns."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import runpy
import subprocess
import urllib.request

ROOT = Path('D:/Projects/Vibe_Coding/cpp-web-fps')
EVIDENCE = ROOT / 'docs/evidence'
RUN = EVIDENCE / '20261030T084415Z'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def raw_checks(receipt, directory, prefix=''):
    for check in receipt['checks']:
        assert check['exit_status'] == 0 and not check.get('timed_out', False), check['name']
        for stream in ['stdout', 'stderr']:
            path = directory / f'{prefix}{check["name"]}.{stream}.txt'
            assert sha(path.read_bytes()) == check[f'{stream}_sha256'], str(path)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['index', 'head'], required=True)
    parser.add_argument('--save')
    args = parser.parse_args()
    original = json.loads((RUN / 'receipt.json').read_text(encoding='utf-8'))
    assert original['passed'] and original['inputs_unchanged']
    inputs = runpy.run_path(str(ROOT / 'scripts/verify.py'))['inputs']()
    assert inputs == original['source_sha256'], 'input path set or bytes changed'
    raw_checks(original, RUN)
    for name, expected in original['outputs'].items():
        assert sha((ROOT / name).read_bytes()) == expected, name
    for entry in original['captures'].values():
        data = (ROOT / entry['archived_path']).read_bytes()
        assert sha(data) == entry['sha256']
        assert int.from_bytes(data[16:20], 'big') == entry['width']
        assert int.from_bytes(data[20:24], 'big') == entry['height']
    clean = json.loads((RUN / 'clean-install.json').read_text(encoding='utf-8'))
    assert clean['passed'] and clean['tested_revision'] == original['tested_revision']
    assert clean['final_clone_git_state'] == '' and clean['static_source_byte_match']
    assert clean['source_files_checked'] == len(inputs)
    assert all(item['matches'] for item in clean['compared_outputs'].values())
    raw_checks(clean, RUN, 'clean-')
    origin_dir = RUN / 'primary-origin'
    origin = json.loads((origin_dir / 'receipt.json').read_text(encoding='utf-8'))
    assert origin['exit_status'] == 0 and origin['tested_revision'] == original['tested_revision']
    for stream in ['stdout', 'stderr']:
        assert sha((origin_dir / f'{stream}.txt').read_bytes()) == origin[f'{stream}_sha256']
    assert sha((origin_dir / 'direct.config.mjs').read_bytes()) == origin['config_sha256']
    for name, expected in origin['captures'].items():
        assert sha((origin_dir / 'captures' / name).read_bytes()) == expected, name
    review = json.loads((EVIDENCE / 'review-final.json').read_text(encoding='utf-8'))
    assert review['verdict'] == 'ship' and review['findings'] == []
    for name, expected in review['source_scope']['sha256'].items():
        assert sha((ROOT / name).read_bytes()) == expected, name
    visual = json.loads((EVIDENCE / 'visual-final.json').read_text(encoding='utf-8'))
    assert visual['verdict'] == 'PASS' and visual['score'] >= 90 and visual['differences'] == []
    current = git('rev-parse', 'HEAD').decode().strip()
    changed = git('diff', '--name-only', original['tested_revision'], 'HEAD').decode().splitlines()
    assert all(p.startswith('docs/evidence/') or p == 'docs/VERIFICATION.md' for p in changed), changed
    assets = {}
    for name in original['served_assets']:
        url = origin['origin'] + ('/' if name == 'index.html' else '/' + name)
        with urllib.request.urlopen(url, timeout=5) as response:
            assert response.status == 200
            actual = sha(response.read())
        assert actual == sha((ROOT / 'web' / name).read_bytes()), name
        assets[name] = actual
    with urllib.request.urlopen(origin['origin'] + '/health', timeout=5) as response:
        assert response.status == 200
        health = json.loads(response.read())
    assert health.get('ok') is True, health
    net = subprocess.check_output(['netstat', '-ano'], text=True, encoding='utf-8', errors='replace')
    listeners = []
    for line in net.splitlines():
        parts = line.split()
        if len(parts) == 5 and parts[0] == 'TCP' and parts[1].endswith(':8088') and parts[3] == 'LISTENING':
            listeners.append({'address': parts[1], 'pid': int(parts[4])})
    assert len(listeners) == 1 and listeners[0]['address'] == '127.0.0.1:8088', listeners
    tracked = {p.decode() for p in git('ls-files', '-z', '--', 'docs/evidence').split(b'\0') if p}
    disk = {p.relative_to(ROOT).as_posix() for p in EVIDENCE.rglob('*') if p.is_file()}
    assert tracked == disk, {'not_archived': sorted(disk - tracked), 'missing': sorted(tracked - disk)}
    prefix = ':' if args.mode == 'index' else 'HEAD:'
    archive_paths = sorted(disk | {'docs/VERIFICATION.md'})
    for name in archive_paths:
        assert git('show', prefix + name) == (ROOT / name).read_bytes(), name
    diff_command = ['git', 'diff', '--cached', '--check'] if args.mode == 'index' else ['git', 'show', '--format=', '--check', 'HEAD']
    subprocess.run(diff_command, cwd=ROOT, check=True, capture_output=True)
    result = {
        'schema': 'crossyard_closure_provenance/v1',
        'checked_at': datetime.now(timezone.utc).isoformat(),
        'checked_revision': current,
        'original_tested_revision': original['tested_revision'],
        'original_execution_receipt': 'docs/evidence/20261030T084415Z/receipt.json',
        'runtime_input_path_set_and_hashes_match': True,
        'runtime_inputs_checked': len(inputs),
        'build_output_hashes_match': True,
        'build_outputs_checked': len(original['outputs']),
        'original_raw_command_logs_match': True,
        'main_commands_checked': len(original['checks']),
        'clean_install_commands_checked': len(clean['checks']),
        'main_captures_checked': len(original['captures']),
        'primary_origin_captures_checked': len(origin['captures']),
        'reviewed_source_files_match': len(review['source_scope']['sha256']),
        'served_asset_sha256': assets,
        'primary_origin': origin['origin'],
        'health': health,
        'listeners': listeners,
        'archive_mode': args.mode,
        'byte_identical_archived_files': len(archive_paths),
        'changes_since_execution_are_docs_only': True,
        'changed_paths_since_execution': changed,
        'new_application_tests_run': False,
        'carried_results': original['counts'],
        'not_observed': ['physical LAN devices', 'existing user browser profile and hand input', 'remote CI, push, deployment'],
    }
    if args.save:
        target = ROOT / args.save
        assert target.parent == EVIDENCE and not target.exists()
        target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'changed_paths_since_execution'}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
