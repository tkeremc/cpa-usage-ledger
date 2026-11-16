"""Check tracked Git index contents for accidental private files and common secrets.

This is a focused local guard, not a guarantee that all possible secrets are detected.
Findings show file names and categories, never matched values. Untracked files are not published.
"""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    'private key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'GitHub credential': re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b'),
    'provider credential': re.compile(rb'\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b'),
    'literal bearer credential': re.compile(rb'Bearer\s+[A-Za-z0-9._-]{32,}'),
    'personal home directory': re.compile(rb'/home/[a-zA-Z0-9][a-zA-Z0-9_.-]*/'),
    'private email': re.compile(rb'[a-zA-Z0-9_.+-]+@(?:outlook|hotmail|gmail|icloud|yahoo)\.[a-zA-Z]{2,}'),
}


def check():
    result = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, check=True)
    files = [name.decode() for name in result.stdout.split(b'\0') if name]
    if not files:
        print('No tracked files; stage the source allowlist before checking.', file=sys.stderr)
        return 1
    findings = []
    for name in files:
        p = Path(name)
        if (p.name in ('config.yaml', 'management.html', 'client.env') or p.name.startswith('.env')
                or p.suffix in ('.key', '.pem', '.so', '.db', '.csv', '.log', '.p12', '.pfx')
                or '.sqlite' in p.name or any(part in ('auths', 'auth-files', 'backups', '.shadow', 'dist', '__pycache__') for part in p.parts)):
            findings.append((name, 'private/runtime file'))
        data = subprocess.run(['git', 'show', ':'+name], cwd=ROOT, capture_output=True, check=True).stdout
        if b'\0' in data:
            findings.append((name, 'binary file'))
        for label, pattern in PATTERNS.items():
            if pattern.search(data):
                findings.append((name, label))
    for name, label in findings:
        print(f'FAIL: {name}: {label}', file=sys.stderr)
    if findings:
        return 1
    print(f'PASS: {len(files)} tracked source files; no private/runtime files or detected secret patterns.')
    return 0


if __name__ == '__main__':
    sys.exit(check())
