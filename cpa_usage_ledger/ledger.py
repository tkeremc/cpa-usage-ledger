"""Local persistence used by the native CPA usage plugin. No network or credentials."""
from contextlib import contextmanager
from datetime import date, datetime, time as daytime, timedelta, timezone
import hashlib
import hmac
import json
import math
from pathlib import Path
import secrets
import sqlite3
from zoneinfo import ZoneInfo
UTC = timezone.utc
ISTANBUL = ZoneInfo("Europe/Istanbul")
SCHEMA = """
CREATE TABLE IF NOT EXISTS keys (
 id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', known INTEGER NOT NULL DEFAULT 0,
 first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY, identity TEXT NOT NULL UNIQUE,
 timestamp TEXT NOT NULL, day TEXT NOT NULL, key_id TEXT NOT NULL REFERENCES keys(id),
 provider TEXT NOT NULL, model TEXT NOT NULL, alias TEXT NOT NULL,
 endpoint TEXT NOT NULL, auth_type TEXT NOT NULL, auth_index TEXT NOT NULL,
 request_id TEXT NOT NULL, execution_id TEXT NOT NULL,
 latency_ms REAL NOT NULL, failed INTEGER NOT NULL, status_code INTEGER,
 input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
 reasoning_tokens INTEGER NOT NULL, cached_tokens INTEGER NOT NULL,
 total_tokens INTEGER NOT NULL, metadata TEXT NOT NULL, collected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_time ON events(timestamp);
CREATE INDEX IF NOT EXISTS events_key_time ON events(key_id,timestamp);
CREATE INDEX IF NOT EXISTS events_model_time ON events(model,timestamp);
"""


def now():
    return datetime.now(UTC).isoformat(timespec="microseconds")


def number(value, integer=False):
    try:
        result = float(value)
        if not math.isfinite(result) or result < 0 or result > 9e15:
            return 0
        return int(result) if integer else result
    except (ValueError, TypeError, OverflowError):
        return 0


def text(value, maximum=500):
    return str(value or "")[:maximum]


class Ledger:
    def __init__(self, state: Path):
        self.state = state
        state.mkdir(parents=True, exist_ok=True, mode=0o700)
        state.chmod(0o700)
        salt_path = state / "fingerprint.key"
        try:
            with salt_path.open("xb") as f:
                f.write(secrets.token_bytes(32))
        except FileExistsError:
            pass
        salt_path.chmod(0o600)
        self.salt = salt_path.read_bytes()
        self.path = state / "usage.sqlite3"
        with self.connect() as db:
            db.executescript(SCHEMA)
            db.execute("PRAGMA journal_mode=WAL")
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA synchronous=FULL")
            with db:
                yield db
        finally:
            db.close()

    def fingerprint(self, key):
        if not key:
            return "unattributed"
        return hmac.new(self.salt, str(key).encode(), hashlib.sha256).hexdigest()

    def sync_keys(self, keys):
        if not isinstance(keys, list) or any(not isinstance(k, str) for k in keys):
            raise ValueError("Unexpected client key schema")
        with self.connect() as db:
            for key in keys:
                if not key:
                    continue
                db.execute("""INSERT INTO keys(id,known,first_seen,last_seen) VALUES(?,1,?,?)
                    ON CONFLICT(id) DO UPDATE SET known=1""", (self.fingerprint(key), now(), now()))

    def normalize(self, event):
        if not isinstance(event, dict):
            raise ValueError("Not an object")
        timestamp = datetime.fromisoformat(str(event["timestamp"]).replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            raise ValueError("Timestamp must contain timezone")
        timestamp = timestamp.astimezone(UTC)
        tokens = event.get("tokens") or {}
        if not isinstance(tokens, dict):
            raise ValueError("Invalid token object")
        key_id = self.fingerprint(event.get("api_key"))
        fields = {name: text(event.get(name)) for name in (
            "provider", "model", "alias", "endpoint", "auth_type", "auth_index", "request_id", "execution_id"
        )}
        failure = event.get("fail") or {}
        status_code = number(failure.get("status_code"), True) if isinstance(failure, dict) else 0
        failed = event.get("failed") is True
        if not status_code and not failed:
            status_code = 200
        # Explicit allow-list: never persist raw records, keys, headers, prompts or failure bodies.
        metadata = {}
        for name in ("stream", "generate", "is_native_key", "is_fork", "is_compaction"):
            if isinstance(event.get(name), bool):
                metadata[name] = event[name]
        for name in ("ttft_ms", "accounting_version", "image_count", "web_search_requests"):
            if isinstance(event.get(name), (int, float)):
                metadata[name] = number(event[name])
        for name in ("reasoning_effort", "service_tier", "effective_service_tier", "response_service_tier",
                     "response_model", "executor_type", "access_provider"):
            if event.get(name) is not None:
                metadata[name] = text(event[name], 150)
        metadata["tokens"] = {k: number(v, True) for k, v in tokens.items()
                              if isinstance(k, str) and k.endswith("tokens") and isinstance(v, (int, float))}
        if isinstance(failure, dict) and failure.get("code"):
            metadata["error_code"] = text(failure["code"], 150)
        normalized = dict(
            timestamp=timestamp.isoformat(timespec="microseconds"),
            day=timestamp.astimezone(ISTANBUL).date().isoformat(), key_id=key_id,
            **fields, latency_ms=number(event.get("latency_ms")), failed=int(failed),
            status_code=status_code or None,
            **{name: number(tokens.get(name), True) for name in (
                "input_tokens", "output_tokens", "reasoning_tokens", "cached_tokens", "total_tokens"
            )}, metadata=json.dumps(metadata, ensure_ascii=False, sort_keys=True),
        )
        # Include model/key/provider even with an execution ID: split-model usage must survive.
        identity = {k: normalized[k] for k in (
            "timestamp", "key_id", "provider", "model", "alias", "auth_index", "request_id", "execution_id",
            "failed", "input_tokens", "output_tokens", "reasoning_tokens", "cached_tokens", "total_tokens"
        )}
        normalized["identity"] = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        normalized["collected_at"] = now()
        return normalized

    def ingest(self, records):
        prepared, invalid = [], 0
        for event in records:
            try:
                prepared.append(self.normalize(event))
            except (ValueError, KeyError, TypeError, OverflowError):
                invalid += 1
        inserted = 0
        with self.connect() as db:
            for event in prepared:
                db.execute("""INSERT INTO keys(id,first_seen,last_seen) VALUES(?,?,?)
                    ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen""",
                    (event["key_id"], event["timestamp"], event["timestamp"]))
                names = list(event)
                cursor = db.execute(
                    "INSERT OR IGNORE INTO events(" + ",".join(names) + ") VALUES(" + ",".join("?" for _ in names) + ")",
                    [event[k] for k in names])
                inserted += cursor.rowcount
        return inserted, invalid

    def rename_key(self, key_id, name):
        if not isinstance(name, str) or len(name.strip()) > 80:
            raise ValueError("Name must be at most 80 characters.")
        with self.connect() as db:
            if not db.execute("UPDATE keys SET name=? WHERE id=?", (name.strip(), key_id)).rowcount:
                raise ValueError("API key identifier not found.")

    def filters(self, params):
        clauses, values = [], []
        dates = {}
        for field, operator in (("from", ">="), ("to", "<")):
            value = params.get(field, "")
            if value:
                chosen = date.fromisoformat(value)
                dates[field] = chosen
                if field == "to":
                    chosen += timedelta(days=1)
                boundary = datetime.combine(chosen, daytime.min, ISTANBUL).astimezone(UTC)
                clauses.append("e.timestamp " + operator + " ?")
                values.append(boundary.isoformat(timespec="microseconds"))
        if "from" in dates and "to" in dates and dates["from"] > dates["to"]:
            raise ValueError("Start date must not be after end date.")
        for field in ("key_id", "model", "provider"):
            if params.get(field):
                clauses.append("e." + field + " = ?")
                values.append(params[field])
        status = params.get("status", "")
        if status:
            if status not in ("success", "failed"):
                raise ValueError("Invalid status filter.")
            clauses.append("e.failed = ?")
            values.append(1 if status == "failed" else 0)
        return (" WHERE " + " AND ".join(clauses) if clauses else ""), values

    def report(self, params):
        where, values = self.filters(params)
        page = max(1, min(1000000, int(params.get("page", 1))))
        size = 50
        aggregate = """COUNT(*) AS records, COALESCE(SUM(e.failed),0) AS failed,
            COALESCE(SUM(e.input_tokens),0) AS input_tokens,
            COALESCE(SUM(e.output_tokens),0) AS output_tokens,
            COALESCE(SUM(e.reasoning_tokens),0) AS reasoning_tokens,
            COALESCE(SUM(e.cached_tokens),0) AS cached_tokens,
            COALESCE(SUM(e.total_tokens),0) AS total_tokens,
            COALESCE(AVG(e.latency_ms),0) AS avg_latency_ms,
            COUNT(DISTINCT NULLIF(e.request_id,'')) AS identified_requests"""
        with self.connect() as db:
            summary = dict(db.execute("SELECT " + aggregate + " FROM events e" + where, values).fetchone())
            keys = [dict(r) for r in db.execute("SELECT * FROM keys ORDER BY name,first_seen")]
            groups = [dict(r) for r in db.execute(
                "SELECT e.key_id,k.name,k.known," + aggregate + " FROM events e JOIN keys k ON k.id=e.key_id" +
                where + " GROUP BY e.key_id ORDER BY total_tokens DESC", values)]
            days = [dict(r) for r in db.execute(
                "SELECT e.day,COUNT(*) AS records,SUM(e.total_tokens) AS tokens FROM events e" +
                where + " GROUP BY e.day ORDER BY e.day", values)]
            by_model = [dict(r) for r in db.execute(
                "SELECT e.model,COUNT(*) AS records,SUM(e.total_tokens) AS tokens FROM events e" +
                where + " GROUP BY e.model ORDER BY tokens DESC", values)]
            events = [dict(r) for r in db.execute(
                "SELECT e.*,k.name AS key_name,k.known FROM events e JOIN keys k ON k.id=e.key_id" +
                where + " ORDER BY e.timestamp DESC,e.id DESC LIMIT ? OFFSET ?", values + [size, (page-1)*size])]
            for event in events:
                event.pop("identity")
                event["metadata"] = json.loads(event["metadata"])
            models = [r[0] for r in db.execute("SELECT DISTINCT model FROM events ORDER BY model")]
            providers = [r[0] for r in db.execute("SELECT DISTINCT provider FROM events ORDER BY provider")]
        return dict(summary=summary, keys=keys, groups=groups, days=days, by_model=by_model,
                    events=events, models=models, providers=providers, page=page, page_size=size,
                    timezone="Europe/Istanbul")

    def export(self, params):
        where, values = self.filters(params)
        with self.connect() as db:
            cursor = db.execute("""SELECT e.timestamp,k.name AS key_name,e.key_id,e.provider,e.model,e.alias,
                e.endpoint,e.auth_index,e.request_id,e.execution_id,e.failed,e.status_code,e.latency_ms,
                e.input_tokens,e.output_tokens,e.reasoning_tokens,e.cached_tokens,e.total_tokens,e.metadata
                FROM events e JOIN keys k ON e.key_id=k.id""" + where + " ORDER BY e.timestamp,e.id", values)
            yield [column[0] for column in cursor.description]
            for row in cursor:
                # Escape spreadsheet formulas in user-controlled strings.
                yield ["'" + value if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@"))
                       else value for value in row]
