"""Configuration primitives for the Main Agent module."""

from __future__ import annotations

from dataclasses import dataclass
import os


@dataclass(frozen=True)
class MainAgentConfig:
    """Runtime configuration for Main Agent optimization.

    The defaults target the hackathon demo path: OpenAI ``gpt-5.5`` plus the
    W&B Weave project that stores sub-agent attack traces.
    """

    model_name: str = "gpt-5.5"
    max_history_items: int = 5
    weave_project_name: str = "weavehacks-redteam-subagents"

    @classmethod
    def from_env(cls) -> "MainAgentConfig":
        """Create config from environment variables with demo-safe defaults."""

        project = os.getenv("WANDB_PROJECT", cls.weave_project_name).strip()
        entity = os.getenv("WANDB_ENTITY", "").strip()
        qualified_project = f"{entity}/{project}" if entity else project

        max_history_raw = os.getenv("MAIN_AGENT_MAX_HISTORY", str(cls.max_history_items))
        try:
            max_history_items = max(1, int(max_history_raw))
        except ValueError:
            max_history_items = cls.max_history_items

        # The Main Agent runs on a stronger model than the sub-agents, so it has
        # its own knob (``MAIN_AGENT_MODEL``) instead of the shared
        # ``OPENAI_MODEL`` used by sub-agents. Defaults to OpenAI GPT-5.5.
        return cls(
            model_name=os.getenv("MAIN_AGENT_MODEL", cls.model_name).strip() or cls.model_name,
            max_history_items=max_history_items,
            weave_project_name=qualified_project,
        )
