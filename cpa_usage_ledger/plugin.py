"""Native CPA plugin handlers. No HTTP listener, .env reader or stored management key."""
import base64
import csv
import io
import json
import os
from pathlib import Path
import sqlite3
import threading

from .ledger import Ledger, now
from .panel_patch import patch_panel, DEFAULT_PANEL

ROOT = Path(__file__).resolve().parents[1]
STATE = Path(os.environ.get("CPA_USAGE_DATA_DIR") or (Path.home() / ".local/share/cliproxy-usage"))
API = "/v0/management/plugins/cpa-usage-ledger"
RESOURCE = "/v0/resource/plugins/cpa-usage-ledger/"
_ledger = None
_lock = threading.RLock()
_status = {"started_at": now(), "last_poll": None, "last_saved": None,
           "last_error": None, "saved": 0, "invalid": 0, "connected": True, "configured": True}


def ledger():
    global _ledger
    if _ledger is None:
        _ledger = Ledger(STATE)
    return _ledger


def snake(name):
    import re
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def normalize_record(record):
    if "timestamp" in record:
        return record
    mapping = {"provider": "Provider", "model": "Model", "alias": "Alias", "api_key": "APIKey",
               "auth_type": "AuthType", "auth_index": "AuthIndex", "timestamp": "RequestedAt",
               "request_id": "TraceID", "execution_id": "RequestID", "stream": "Stream",
               "is_native_key": "IsNativeKey", "failed": "Failed", "service_tier": "ServiceTier",
               "executor_type": "ExecutorType", "reasoning_effort": "ReasoningEffort"}
    result = {target: record[source] for target, source in mapping.items() if source in record}
    result["tokens"] = {snake(k): v for k, v in (record.get("Detail") or {}).items() if k.endswith("Tokens")}
    result["latency_ms"] = (record.get("Latency") or 0) / 1_000_000
    result["ttft_ms"] = (record.get("TTFT") or 0) / 1_000_000
    # Failure body and response headers are intentionally excluded.
    result["fail"] = {"status_code": (record.get("Failure") or {}).get("StatusCode", 0)}
    return result


def envelope(result):
    return json.dumps({"ok": True, "result": result}, ensure_ascii=False).encode()


def response(body, content_type="application/json; charset=utf-8", status=200, extra=None):
    if not isinstance(body, bytes):
        body = json.dumps(body, ensure_ascii=False).encode()
    headers = {"Content-Type": [content_type], "Cache-Control": ["no-store"],
               "X-Content-Type-Options": ["nosniff"], "Referrer-Policy": ["no-referrer"],
               "Content-Security-Policy": ["default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'"]}
    headers.update(extra or {})
    return {"StatusCode": status, "Headers": headers, "Body": base64.b64encode(body).decode()}


def unwrap(request, field):
    if isinstance(request.get(field), dict):
        return request[field]
    if isinstance(request.get(field.title()), dict):
        return request[field.title()]
    return request


def dispatch(method, request):
    if method in ("plugin.register", "plugin.reconfigure"):
        ledger()
        if 'config_yaml' in request and DEFAULT_PANEL.is_file():
            try:
                patch_panel()
            except (OSError, ValueError):
                _status['integration_error'] = 'Management Center session integration needs updating.'
        return {"schema_version": 1,
                "metadata": {"Name": "CPA Usage Ledger", "Version": "0.3.2", "Author": "CPA Usage Ledger contributors", "GitHubRepository": "https://github.com/tkeremc/cpa-usage-ledger", "ConfigFields": []},
                "capabilities": {"usage_plugin": True, "management_api": True}}
    if method in ("plugin.shutdown", "plugin.quiesce"):
        return {}
    if method == "usage.handle":
        record = normalize_record(unwrap(request, "record"))
        if record.get("is_native_key") is True and record.get("api_key"):
            ledger().sync_keys([record["api_key"]])
        added, invalid = ledger().ingest([record])
        _status.update(last_poll=now(), last_saved=now(), saved=_status["saved"]+added, invalid=_status["invalid"]+invalid)
        return {}
    if method == "management.register":
        return {"Routes": [{"Method": "GET", "Path": "/plugins/cpa-usage-ledger/report"},
                           {"Method": "GET", "Path": "/plugins/cpa-usage-ledger/export.csv"},
                           {"Method": "POST", "Path": "/plugins/cpa-usage-ledger/key-name"},
                           {"Method": "POST", "Path": "/plugins/cpa-usage-ledger/key-labels"}],
                "Resources": [{"Path": "/index.html", "Menu": "Usage history", "Description": "Usage history by API key and date."},
                              {"Path": "/app.js"}, {"Path": "/session.js"}, {"Path": "/style.css"}]}
    if method == "management.handle":
        request = unwrap(request, "request")
        path = request.get("Path", "")
        verb = request.get("Method", "GET")
        if path.startswith(RESOURCE) and verb == "GET":
            name = path[len(RESOURCE):]
            if name not in ("index.html", "app.js", "session.js", "style.css"):
                return response({"error": "Not found."}, status=404)
            types = {"index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "session.js": "text/javascript; charset=utf-8", "style.css": "text/css; charset=utf-8"}
            return response((ROOT / "static" / name).read_bytes(), types[name])
        # Only authenticated host management routes reach this branch.
        params = {k: value[-1] if isinstance(value, list) else value for k, value in (request.get("Query") or {}).items()}
        if path == API + "/report" and verb == "GET":
            report = ledger().report(params)
            report["collector"] = dict(_status)
            return response(report)
        if path == API + "/key-labels" and verb == "POST":
            data = base64.b64decode(request.get("Body") or "", validate=True)
            if len(data) > 262144:
                raise ValueError("Request is too large.")
            entries = json.loads(data)
            ledger().sync_key_labels(entries)
            # Return a bounded preview, never the whole key (even for short keys).
            previews = {ledger().fingerprint(entry['key']): entry['key'][:min(8, len(entry['key']) // 2)] + '…'
                        for entry in entries}
            return response({"ok": True, "key_previews": previews})
        if path == API + "/key-name" and verb == "POST":
            data = base64.b64decode(request.get("Body") or "", validate=True)
            if len(data) > 4096:
                raise ValueError("Request is too large.")
            data = json.loads(data)
            ledger().rename_key(data["key_id"], data["name"])
            return response({"ok": True})
        if path == API + "/export.csv" and verb == "GET":
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerows(ledger().export(params))
            return response(b"\xef\xbb\xbf"+output.getvalue().encode(), "text/csv; charset=utf-8",
                            extra={"Content-Disposition": ['attachment; filename="usage.csv"']})
        return response({"error": "Not found."}, status=404)
    raise ValueError("Unsupported plugin method.")


def handle(method, raw):
    try:
        request = json.loads(raw or b"{}")
        if not isinstance(request, dict):
            raise ValueError("Invalid request.")
        with _lock:
            return envelope(dispatch(method, request))
    except (ValueError, TypeError, KeyError, OSError, sqlite3.Error, OverflowError):
        if method == "management.handle":
            return envelope(response({"error": "Invalid request, filter or local data operation."}, status=400))
        return json.dumps({"ok": False, "error": {"code": "plugin_error", "message": "Usage record could not be processed; credentials were not logged."}}).encode()
