"""Add a bounded, memory-only session bridge to the local Management Center bundle."""
from pathlib import Path
import gzip
import os
import re
import tempfile

ROOT = Path(__file__).resolve().parents[1]
_override = os.environ.get('MANAGEMENT_STATIC_PATH', '').strip()
DEFAULT_PANEL = Path(_override) if _override else Path.home() / '.cli-proxy-api/static/management.html'
if _override and DEFAULT_PANEL.name != 'management.html':
    DEFAULT_PANEL /= 'management.html'
BEGIN = '/* CPA_USAGE_BRIDGE_BEGIN */'
END = '/* CPA_USAGE_BRIDGE_END */'
ANCHOR = re.compile(r'typeof window<`u`&&\(window\.addEventListener\(`unauthorized`,\(\)=>\{([A-Za-z_$][\w$]*)\.getState\(\)\.logout\(\)\}\)')


def patch_panel(path=DEFAULT_PANEL, backup=True):
    path = Path(path)
    original = path.read_text()
    clean = re.sub(re.escape(BEGIN)+r'.*?'+re.escape(END), '', original, flags=re.S)
    matches = list(ANCHOR.finditer(clean))
    if len(matches) != 1:
        raise ValueError('This Management Center build has no recognized session integration point; the file was not changed.')
    match = matches[0]
    script = (ROOT / 'panel_bridge.js').read_text().replace('__CPA_AUTH_STORE__', match.group(1))
    injected = BEGIN + ';' + script + END
    updated = clean[:match.start()] + injected + clean[match.start():]
    if updated == original:
        return False
    if backup:
        directory = path.parent.parent / 'backups'
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        saved = directory / 'management.before-usage-integration.html.gz'
        if not saved.exists():
            with saved.open('xb') as output:
                output.write(gzip.compress(original.encode(), mtime=0))
            saved.chmod(0o600)
    mode = path.stat().st_mode & 0o777
    fd, temporary = tempfile.mkstemp(prefix='.management.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            output.write(updated)
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return True
