"""
calculate_metrics.py

Discovers every metric script in this directory, runs its calculate_* function
against every JSON file in testdata/, and prints a consolidated report.

Convention: each sibling .py file must expose at least one function whose name
starts with "calculate_" and accepts a single positional argument (json_filepath).
"""

import importlib.util
import inspect
import json
import os
import sys
from pathlib import Path

METRICS_DIR = Path(__file__).parent
TESTDATA_DIR = METRICS_DIR.parent / "testdata"


def _load_metric_functions() -> list[tuple[str, callable]]:
    """Return (qualified_name, fn) for every calculate_* fn in each subdir's main.py."""
    fns = []
    for main_path in sorted(METRICS_DIR.glob("*/main.py")):
        subdir = main_path.parent.name
        spec = importlib.util.spec_from_file_location(subdir, main_path)
        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)
        except Exception as e:
            print(f"  [warn] could not load {subdir}/main.py: {e}", file=sys.stderr)
            continue
        for name, obj in inspect.getmembers(module, inspect.isfunction):
            if name.startswith("calculate_"):
                fns.append((f"{subdir}.{name}", obj))
    return fns


def _load_testdata_files() -> list[Path]:
    if not TESTDATA_DIR.exists():
        return []
    return sorted(TESTDATA_DIR.glob("*.json"))


def run_all() -> dict:
    """Run all metrics against all testdata files. Returns nested results dict."""
    metric_fns = _load_metric_functions()
    data_files = _load_testdata_files()

    if not metric_fns:
        print("No metric functions found in metrics/.")
        return {}
    if not data_files:
        print(f"No JSON files found in {TESTDATA_DIR}.")
        return {}

    results = {}

    for data_path in data_files:
        file_key = data_path.name
        results[file_key] = {}
        print(f"\n{'=' * 60}")
        print(f"  Data file: {data_path.name}")
        print(f"{'=' * 60}")

        for fn_name, fn in metric_fns:
            try:
                ret = fn(str(data_path))
                results[file_key][fn_name] = ret
                _print_result(fn_name, ret)
            except Exception as e:
                msg = f"ERROR: {e}"
                results[file_key][fn_name] = msg
                print(f"  [{fn_name}]  {msg}")

    return results


_TUPLE_LABELS: dict[str, list[str]] = {
    "vulnerabilities_per_million_tokens": ["vulns_per_million_tokens", "vulnerability_count", "total_tokens"],
    "score_delta_on_breach":              ["mean_delta", "max_delta", "breach_count", "deltas"],
    "estimated_cost":                     ["total_cost_usd", "cost_per_trace_usd", "trace_count"],
    "decision_distribution":              ["approved_count", "denied_count", "approved_pct", "denied_pct"],
    "expected_vs_actual_agreement_rate":  ["agreement_count", "disagreement_count", "agreement_rate_pct", "total"],
    "latency":                            ["mean_ms", "min_ms", "max_ms", "p50_ms", "p95_ms", "trace_count"],
}


def _print_result(fn_name: str, ret) -> None:
    print(f"\n  [{fn_name}]")
    subdir = fn_name.split(".")[0]
    if isinstance(ret, tuple):
        labels = _TUPLE_LABELS.get(subdir, [])
        for i, val in enumerate(ret):
            label = labels[i] if i < len(labels) else f"value_{i}"
            if isinstance(val, float):
                print(f"    {label}: {val:.4f}")
            else:
                print(f"    {label}: {val}")
    elif isinstance(ret, dict):
        for k, v in ret.items():
            if isinstance(v, float):
                print(f"    {k}: {v:.4f}")
            else:
                print(f"    {k}: {v}")
    elif isinstance(ret, float):
        print(f"    result: {ret:.4f}")
    else:
        print(f"    result: {ret}")


if __name__ == "__main__":
    results = run_all()
    print(f"\n{'=' * 60}")
    print("  Done.")
    print(f"{'=' * 60}\n")
