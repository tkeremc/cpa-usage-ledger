# CPA Usage Ledger

A local usage history plugin for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI).
Track usage by client API key, model and date without a separate dashboard service.

**Experimental, Linux only.** Verified against CPA 8.0.74 on Linux x86_64 with CPython 3.14.
The panel integration depends on the installed Management Center bundle. It fails without
changing the file when its integration point is not recognized. This is an independent project.

## Features

- Durable SQLite history collected through CPA's native usage plugin interface.
- Filters for date range, client key, model, provider and success/failure.
- Input, output, cached, reasoning and total tokens; latency and available first-token timing.
- API key names from Management Center, daily charts, request details and CSV export.
- Embedded Management Center page using the existing session, with no second sidebar or login.
- English and Turkish; the page follows the parent's language and light/white/dark theme.
- Python standard library backend, plain JavaScript frontend, no analytics or CDN assets.

## Before installing

This is a **native plugin**, not a sandboxed browser extension: it executes code inside CPA.
The C bridge embeds the system CPython shared library and calls the Python source in this checkout.
Review the source and build locally. Keep the checkout in place after compiling; rebuild if you
move it or upgrade the system Python minor version.

Sharing the current panel session requires a small local change to `management.html`.
**Set `management.disable-auto-update-panel: true` before restarting CPA.** Otherwise CPA's
background downloader overwrites that change on startup. Only panel auto-updates are disabled;
you must apply Management Center updates manually and reapply the integration afterward.
This plugin does not provide automatic frontend compatibility across CPA releases.

## Build and install

Requirements: Linux, GCC, Bash, CPython 3.11+ built with a shared library, matching Python
headers and `python3-config`, and system timezone data. Node.js is needed only to run UI tests.
Only CPython 3.14/x86_64 has been verified locally; other versions and arm64 need validation.
For example, Debian/Ubuntu packages include `build-essential python3-dev tzdata`; Arch packages
include `base-devel python tzdata`.

1. Clone the repository to a permanent directory:

   ```bash
   git clone https://github.com/tkeremc/cpa-usage-ledger.git
   cd cpa-usage-ledger
   ```

2. Merge [config.example.yaml](config.example.yaml) into your existing CPA configuration.
   Keep your existing management secret, client keys and provider sessions. Replace the plugin
   directory placeholder with an absolute path. Do not overwrite the whole CPA configuration.

3. Build, patch the local Management Center and install into that same plugin directory:

   ```bash
   bash install.sh /absolute/path/to/cli-proxy-plugins \
     "$HOME/.cli-proxy-api/static/management.html"
   ```

   This command never edits your CPA YAML or credentials and never restarts CPA.
   Set `PYTHON`, `PYTHON_CONFIG` and `CC` to select matching build tools if needed.
   Build output is `dist/linux/<amd64|arm64>/cpa-usage-ledger.so`.

4. Restart CPA using your normal launcher. For a systemd user installation:

   ```bash
   systemctl --user restart cliproxyapi.service
   ```

5. Reload the **main** Management Center page, then open
   **Plugins → CPA Usage Ledger → Usage history**.
   With the default CPA port the direct link is
   `http://127.0.0.1:8317/management.html#/plugin-pages/cpa-usage-ledger/0`.
   Sign into CPA normally; the plugin has no separate sign-in.

`activate.sh` is an optional systemd convenience helper. It reapplies the panel integration and
restarts `cliproxyapi.service`; set `CPA_SERVICE` for a different user-service name and pass
`--panel /path/to/management.html` for a different panel location. Configure the YAML first.

## Data and accounting

Default storage is `~/.local/share/cliproxy-usage/`. This retains the existing data directory
when upgrading from the original local prototype. Set `CPA_USAGE_DATA_DIR` in CPA's environment
to choose another directory; move **both** `usage.sqlite3` and `fingerprint.key` together.
Stop CPA before moving or backing up the SQLite database, or use SQLite's backup API.

Client keys are identified with HMAC-SHA256 using a local random salt (`fingerprint.key`).
The native usage callback receives the key transiently to calculate its fingerprint; raw keys,
management secrets, prompts, response headers and failure bodies are not written to the ledger.
The directory is mode 0700 and the database and salt are mode 0600. Account indexes, trace IDs,
models, providers, timestamps and user-assigned key labels **are** retained. Treat the whole
storage directory and CSV exports as private. There is no retention limit or automatic deletion.

All reports use `Europe/Istanbul`. Start and end dates include both selected calendar days.
Cached and reasoning tokens are displayed separately and are not added again to total tokens.
A usage event is not necessarily one end-user request: retries and multi-model events may
produce separate records. Available fields depend on CPA and the upstream provider.
The plugin does not estimate missing tokens, billing cost or quota percentages, and cannot
recover events that were never recorded. Existing CPA in-memory totals are not imported.

For a quick check, issue a normal model request using a client key. Its new usage record should
appear in the history; the page refreshes every ten seconds. Use a different client key for
each application to separate its usage.

## Session integration and updates

`panel_bridge.js` runs in the main Management Center module beside its current auth store.
The iframe calls a same-origin bridge which accepts only this plugin's report, CSV and key-label
endpoints. Requests use the current in-memory session, including when “remember password” is off.
The bridge does not return the management key to the iframe or store an extra copy.
CPA still authenticates each management API request. This is not a security sandbox against
other scripts on the same origin; only install code you trust into your CPA process and panel.

Management Center stores API key names in browser storage, scoped to the CPA connection;
they are not part of `config.yaml`. The parent bridge uses the panel's own name helpers,
reads the current client key list from `/v8/management/config/access/api-keys`, and sends
keys and labels transiently to the authenticated plugin's `/key-labels` endpoint. The iframe
receives no raw client keys. Only HMAC identities and labels are saved to SQLite. This fixed
sync operation does not allow the iframe's general request method to access config endpoints.
Names refresh when changed, with a 30-second cache for an unchanged name map.

Filters, per-key totals, request rows and CSV use a label when available and otherwise retain
the short identity display. A manually assigned Ledger name overrides the CPA name; clear it
to use CPA's name again. Removing a CPA name clears that imported label for the active key.
Historical labels are retained for keys removed from CPA. If the installed panel has no recognized
name helpers, Ledger's existing labels and short identities continue to work. Names imported
from the current browser are stored separately from Ledger's manual names; the existing database
is migrated without removing usage or key identities.

`patch_management.py` detects the installed auth-store binding, replaces only its own marked
block, and writes atomically. It keeps one compressed original panel backup at
`<CPA config directory>/backups/management.before-usage-integration.html.gz`.
Repeated runs are idempotent. The original Management Center HTML is not included in this repo.

To update the panel, stop CPA, put the new official `management.html` in place, run
`python3 -B patch_management.py --panel /path/to/management.html`, and restart CPA.
If the integration point is unrecognized, leave CPA stopped while restoring a compatible panel
or adapting this plugin. Keep panel auto-updates disabled while using this integration.

To uninstall, stop CPA, remove the `cpa-usage-ledger.so` installed by `install.sh`, remove its
entry from `plugins.configs`, restore the original panel from the compressed backup (or install
a clean official panel), and optionally re-enable panel auto-updates. Keep the data directory
unless you intentionally want to delete usage history and key labels. Restart CPA afterward.

## Development

```bash
bash build.sh
python3 -B -m unittest discover -s tests -p 'test_*.py' -v
node tests/test_ui.js
python3 -B scripts/check_public.py
```

Tests exercise the compiled C ABI, usage accounting, filtering, CSV export, secret exclusion,
resource routing, session reuse, key rotation, endpoint restrictions, language/theme changes and
idempotent panel patching. They use temporary fixture data, not a running provider account.
Live provider requests, browser appearance and startup-update behavior require manual validation.

Sources: `bridge.c` (ABI/interpreter), `cpa_usage_ledger/plugin.py` (plugin routes), `cpa_usage_ledger/ledger.py`
(storage), `static/` (UI), `panel_bridge.js` / `cpa_usage_ledger/panel_patch.py` (session integration).
No prebuilt native libraries, local CPA configuration, provider accounts or usage data are published.

## License

MIT. UI theme tokens are adapted from the MIT-licensed CLI Proxy API Management Center;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No upstream panel bundle is distributed.
