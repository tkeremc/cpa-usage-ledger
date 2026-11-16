"""Apply the local CPA Usage Ledger session integration to Management Center."""
import argparse
from pathlib import Path
from cpa_usage_ledger.panel_patch import patch_panel, DEFAULT_PANEL

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--panel', type=Path, default=DEFAULT_PANEL, help='Installed management.html path')
    args = parser.parse_args()
    print('Management Center session integration applied.' if patch_panel(args.panel) else 'Management Center session integration is current.')
