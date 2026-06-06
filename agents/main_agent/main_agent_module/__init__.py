"""Main Agent package for attack-direction optimization."""

from .config import MainAgentConfig
from .core_agent import (
    MainAgentCore,
    MainAgentOptimizer,
    build_mock_optimizer_inputs,
    generate_attack_direction,
    run_mock_prompt_preview,
)
from .memory_retriever import (
    InMemoryTraceSummaryRetriever,
    MemoryRecord,
    MemoryRetriever,
    WeaveTraceSummaryRetriever,
    fetch_historical_lessons,
)
from .trace_exporter import (
    DEFAULT_TRACE_FIELDS,
    TraceCallRecord,
    TraceExportResult,
    export_trace_records,
    fetch_trace_records,
    select_trace_fields,
)

__all__ = [
    "InMemoryTraceSummaryRetriever",
    "MainAgentConfig",
    "MainAgentCore",
    "MainAgentOptimizer",
    "MemoryRecord",
    "MemoryRetriever",
    "WeaveTraceSummaryRetriever",
    "DEFAULT_TRACE_FIELDS",
    "TraceCallRecord",
    "TraceExportResult",
    "build_mock_optimizer_inputs",
    "export_trace_records",
    "fetch_historical_lessons",
    "fetch_trace_records",
    "generate_attack_direction",
    "run_mock_prompt_preview",
    "select_trace_fields",
]
