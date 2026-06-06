"""Fetch, normalize, filter, and export W&B Weave trace Calls.

Weave Agent tracing records sessions, turns, LLM calls, and tool calls as
queryable Calls. This module provides a small ETL layer that fetches those Calls
with the Python SDK, normalizes the Call schema, selects only the fields needed
by downstream agents, and optionally writes JSON/JSONL/CSV artifacts.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Mapping, Optional, Sequence

import weave


logger = logging.getLogger(__name__)

DEFAULT_TRACE_FIELDS = (
    "id",
    "op_name",
    "display_name",
    "trace_id",
    "parent_id",
    "started_at",
    "ended_at",
    "exception",
    "attributes.agent_name",
    "attributes.conversation_id",
    "attributes.span_type",
    "inputs.attack_direction",
    "inputs.skill_name",
    "inputs.user_message",
    "output.skill_name",
    "output.payload_sent",
    "output.aut_response",
    "output.is_breached",
    "summary.weave.status",
    "summary.weave.latency_ms",
    "summary.usage",
)


@dataclass(frozen=True)
class TraceCallRecord:
    """Normalized subset of the Weave Call schema."""

    id: str
    project_id: str
    op_name: str
    display_name: str
    trace_id: str
    parent_id: str
    started_at: Any
    ended_at: Any
    attributes: Mapping[str, Any]
    inputs: Mapping[str, Any]
    output: Any
    summary: Mapping[str, Any]
    exception: str
    wb_user_id: str
    wb_run_id: str

    def to_dict(self) -> dict[str, Any]:
        """Return this record as a JSON-serializable dictionary."""

        return _json_safe(asdict(self))


@dataclass(frozen=True)
class TraceExportResult:
    """Metadata returned after exporting selected trace data."""

    output_path: str
    record_count: int
    fields: tuple[str, ...]
    export_format: str


def build_weave_project_name(default_project: str = "weavehacks4-your-idea") -> str:
    """Build a W&B Weave project path from environment variables."""

    import os

    project = os.getenv("WANDB_PROJECT", default_project).strip() or default_project
    entity = os.getenv("WANDB_ENTITY", "").strip()
    return f"{entity}/{project}" if entity else project


@weave.op()
def fetch_trace_records(
    project_name: str,
    *,
    limit: int = 100,
    op_names: Sequence[str] | None = None,
    trace_roots_only: bool | None = None,
    columns: Sequence[str] | None = None,
) -> list[TraceCallRecord]:
    """Fetch recent Weave Calls and normalize them into trace records.

    Args:
        project_name: W&B project path, typically ``entity/project``.
        limit: Maximum number of Calls to retrieve.
        op_names: Optional Weave op refs/names for server-side filtering.
        trace_roots_only: Optional server-side filter for root Calls.
        columns: Optional Call columns to request from Weave.

    Returns:
        Normalized trace records in the order returned by Weave.
    """

    if limit < 1:
        raise ValueError("limit must be >= 1.")

    client = _get_weave_client(project_name)
    calls = _query_weave_calls(
        client=client,
        limit=limit,
        op_names=op_names,
        trace_roots_only=trace_roots_only,
        columns=columns,
    )
    return [normalize_weave_call(call) for call in calls]


@weave.op()
def select_trace_fields(
    records: Sequence[TraceCallRecord | Mapping[str, Any]],
    fields: Sequence[str] = DEFAULT_TRACE_FIELDS,
) -> list[dict[str, Any]]:
    """Select dot-path fields from normalized trace records.

    Field paths use ``.`` separators. Examples:
    - ``inputs.attack_direction``
    - ``output.is_breached``
    - ``summary.weave.status``
    """

    if not fields:
        raise ValueError("fields must include at least one field path.")

    selected_rows: list[dict[str, Any]] = []
    for record in records:
        source = record.to_dict() if isinstance(record, TraceCallRecord) else dict(record)
        selected_rows.append({field: _get_path(source, field) for field in fields})
    return selected_rows


@weave.op()
def export_trace_records(
    project_name: str,
    output_path: str | Path,
    *,
    fields: Sequence[str] = DEFAULT_TRACE_FIELDS,
    limit: int = 100,
    export_format: str = "jsonl",
    op_names: Sequence[str] | None = None,
    trace_roots_only: bool | None = None,
) -> TraceExportResult:
    """Fetch Weave Calls, select fields, and write them to disk."""

    records = fetch_trace_records(
        project_name=project_name,
        limit=limit,
        op_names=op_names,
        trace_roots_only=trace_roots_only,
    )
    rows = select_trace_fields(records, fields=fields)
    resolved_output = Path(output_path)
    write_selected_trace_rows(
        rows=rows,
        output_path=resolved_output,
        export_format=export_format,
    )
    return TraceExportResult(
        output_path=str(resolved_output),
        record_count=len(rows),
        fields=tuple(fields),
        export_format=export_format,
    )


def normalize_weave_call(call: Any) -> TraceCallRecord:
    """Normalize a Weave Call-like object or dictionary."""

    mapping = _as_mapping(call) or {}
    return TraceCallRecord(
        id=str(_read_field(call, "id", mapping.get("id", "")) or ""),
        project_id=str(_read_field(call, "project_id", mapping.get("project_id", "")) or ""),
        op_name=str(_read_field(call, "op_name", mapping.get("op_name", "")) or ""),
        display_name=str(
            _read_field(call, "display_name", mapping.get("display_name", "")) or ""
        ),
        trace_id=str(_read_field(call, "trace_id", mapping.get("trace_id", "")) or ""),
        parent_id=str(_read_field(call, "parent_id", mapping.get("parent_id", "")) or ""),
        started_at=_read_field(call, "started_at", mapping.get("started_at")),
        ended_at=_read_field(call, "ended_at", mapping.get("ended_at")),
        attributes=_as_mapping(_read_field(call, "attributes", mapping.get("attributes"))) or {},
        inputs=_as_mapping(_read_field(call, "inputs", mapping.get("inputs"))) or {},
        output=_read_field(call, "output", mapping.get("output")),
        summary=_as_mapping(_read_field(call, "summary", mapping.get("summary"))) or {},
        exception=str(_read_field(call, "exception", mapping.get("exception", "")) or ""),
        wb_user_id=str(_read_field(call, "wb_user_id", mapping.get("wb_user_id", "")) or ""),
        wb_run_id=str(_read_field(call, "wb_run_id", mapping.get("wb_run_id", "")) or ""),
    )


def write_selected_trace_rows(
    *,
    rows: Sequence[Mapping[str, Any]],
    output_path: str | Path,
    export_format: str = "jsonl",
) -> None:
    """Write selected trace rows as JSONL, JSON, or CSV."""

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    normalized_format = export_format.strip().casefold()
    safe_rows = [_json_safe(dict(row)) for row in rows]

    if normalized_format == "jsonl":
        with path.open("w", encoding="utf-8") as handle:
            for row in safe_rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        return

    if normalized_format == "json":
        with path.open("w", encoding="utf-8") as handle:
            json.dump(safe_rows, handle, ensure_ascii=False, indent=2)
        return

    if normalized_format == "csv":
        fieldnames = list(safe_rows[0].keys()) if safe_rows else []
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in safe_rows:
                writer.writerow({key: _csv_safe(value) for key, value in row.items()})
        return

    raise ValueError("export_format must be one of: jsonl, json, csv.")


def _get_weave_client(project_name: str) -> Any:
    """Initialize Weave and return its client."""

    client = weave.init(project_name)
    if client is not None:
        return client

    client_factory = getattr(weave, "client", None)
    if callable(client_factory):
        fallback_client = client_factory()
        if fallback_client is not None:
            return fallback_client

    raise RuntimeError("Unable to initialize Weave client.")


def _query_weave_calls(
    *,
    client: Any,
    limit: int,
    op_names: Sequence[str] | None,
    trace_roots_only: bool | None,
    columns: Sequence[str] | None,
) -> list[Any]:
    """Query Weave Calls with SDK-version tolerant keyword fallback."""

    if not hasattr(client, "get_calls"):
        raise TypeError("Weave client does not expose get_calls(...).")

    filter_payload: dict[str, Any] = {}
    if op_names:
        filter_payload["op_names"] = list(op_names)
    if trace_roots_only is not None:
        filter_payload["trace_roots_only"] = trace_roots_only

    requested_columns = list(columns or _default_query_columns())
    attempts = [
        {
            "filter": filter_payload or None,
            "limit": limit,
            "columns": requested_columns,
        },
        {"filter": filter_payload or None, "limit": limit},
        {"limit": limit, "columns": requested_columns},
        {"limit": limit},
        {},
    ]

    last_error: Optional[Exception] = None
    for kwargs in attempts:
        clean_kwargs = {key: value for key, value in kwargs.items() if value is not None}
        try:
            return list(client.get_calls(**clean_kwargs))[:limit]
        except TypeError as exc:
            last_error = exc

    raise RuntimeError(f"Unable to query Weave calls: {last_error}")


def _default_query_columns() -> tuple[str, ...]:
    """Columns needed for the default downstream field selection."""

    return (
        "id",
        "project_id",
        "op_name",
        "display_name",
        "trace_id",
        "parent_id",
        "started_at",
        "ended_at",
        "attributes",
        "inputs",
        "output",
        "summary",
        "exception",
        "wb_user_id",
        "wb_run_id",
    )


def _read_field(obj: Any, field_name: str, default: Any = None) -> Any:
    """Read a field from object-like or dict-like values."""

    if isinstance(obj, Mapping):
        return obj.get(field_name, default)
    return getattr(obj, field_name, default)


def _as_mapping(value: Any) -> Optional[Mapping[str, Any]]:
    """Convert common object/model shapes into a mapping when possible."""

    if isinstance(value, Mapping):
        return value
    if hasattr(value, "model_dump"):
        dumped = value.model_dump()
        return dumped if isinstance(dumped, Mapping) else None
    if hasattr(value, "dict"):
        dumped = value.dict()
        return dumped if isinstance(dumped, Mapping) else None
    if hasattr(value, "__dict__"):
        return vars(value)
    return None


def _get_path(source: Mapping[str, Any], path: str) -> Any:
    """Read a dotted path from nested dictionaries/objects."""

    current: Any = source
    for part in path.split("."):
        if isinstance(current, Mapping):
            current = current.get(part)
        else:
            current = getattr(current, part, None)
        if current is None:
            return None
    return _json_safe(current)


def _json_safe(value: Any) -> Any:
    """Convert datetimes and object-like values into JSON-safe values."""

    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(key): _json_safe(nested) for key, nested in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    if hasattr(value, "model_dump"):
        return _json_safe(value.model_dump())
    if hasattr(value, "dict"):
        return _json_safe(value.dict())
    if hasattr(value, "__dict__") and not isinstance(value, type):
        return _json_safe(vars(value))
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


def _csv_safe(value: Any) -> Any:
    """Serialize nested values for CSV cells."""

    if isinstance(value, (Mapping, list, tuple, set)):
        return json.dumps(_json_safe(value), ensure_ascii=False)
    return value


def _parse_fields(raw_fields: str | None) -> tuple[str, ...]:
    """Parse comma-separated field paths."""

    if not raw_fields:
        return DEFAULT_TRACE_FIELDS
    fields = tuple(field.strip() for field in raw_fields.split(",") if field.strip())
    if not fields:
        raise ValueError("--fields did not include any valid field paths.")
    return fields


def main() -> None:
    """CLI entrypoint for exporting selected Weave trace fields."""

    parser = argparse.ArgumentParser(description="Export selected fields from Weave trace Calls.")
    parser.add_argument("--project", default=build_weave_project_name())
    parser.add_argument("--output", default="data/weave_traces/latest_trace_calls.jsonl")
    parser.add_argument("--format", default="jsonl", choices=("jsonl", "json", "csv"))
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--op-name", action="append", dest="op_names")
    parser.add_argument("--trace-roots-only", action="store_true")
    parser.add_argument("--fields", help="Comma-separated dotted field paths to export.")
    args = parser.parse_args()

    result = export_trace_records(
        project_name=args.project,
        output_path=args.output,
        fields=_parse_fields(args.fields),
        limit=args.limit,
        export_format=args.format,
        op_names=args.op_names,
        trace_roots_only=args.trace_roots_only or None,
    )
    print(json.dumps(_json_safe(asdict(result)), indent=2))


if __name__ == "__main__":
    main()
