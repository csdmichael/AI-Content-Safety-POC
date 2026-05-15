"""
NEW FILE — safety/policy_engine.py
Centralized policy enforcement engine.

Loads rules from policies/global_policy.yaml and evaluates inputs/outputs
against blocked keywords, restricted tools, and severity limits.
"""

import os
import re
from pathlib import Path
from typing import Any

# PyYAML is optional — fall back to a minimal inline parser if unavailable.
try:
    import yaml  # type: ignore[import-untyped]
    _HAS_YAML = True
except ImportError:
    _HAS_YAML = False


_REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_yaml_file(path: str) -> dict:
    """Load a YAML file from a repo-relative path."""
    full_path = _REPO_ROOT / path
    if not full_path.is_file():
        return {}
    text = full_path.read_text(encoding="utf-8")
    if _HAS_YAML:
        return yaml.safe_load(text) or {}
    # Minimal fallback: parse simple key-value / list YAML
    return _minimal_yaml_parse(text)


def _minimal_yaml_parse(text: str) -> dict:
    """Very basic YAML parser for flat key: value and key: [list] structures."""
    result: dict[str, Any] = {}
    current_key: str | None = None
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("- ") and current_key is not None:
            val = stripped[2:].strip().strip('"').strip("'")
            if current_key not in result:
                result[current_key] = []
            result[current_key].append(val)
        elif ":" in stripped:
            key, _, value = stripped.partition(":")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            current_key = key
            if value:
                # Try numeric
                try:
                    result[key] = int(value)
                except ValueError:
                    try:
                        result[key] = float(value)
                    except ValueError:
                        result[key] = value
            else:
                result[key] = []
    return result


class PolicyEngine:
    """Evaluates text and tool calls against a loaded global policy."""

    def __init__(self, policy_path: str | None = None) -> None:
        from safety.config import GLOBAL_POLICY_PATH
        path = policy_path or GLOBAL_POLICY_PATH
        self._policy = _load_yaml_file(path)
        self._blocked_keywords: list[str] = self._policy.get("blocked_keywords", [])
        self._restricted_tools: list[str] = self._policy.get("restricted_tools", [])
        self._max_severity: int = int(self._policy.get("max_severity", 6))
        self._enforcement_mode: str = self._policy.get("enforcement_mode", "warn")

        # Pre-compile keyword patterns for efficient matching
        self._keyword_patterns = [
            re.compile(re.escape(kw), re.IGNORECASE)
            for kw in self._blocked_keywords
        ]

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def evaluate_text(self, text: str) -> dict:
        """Check text against blocked keywords.

        Returns:
            {
                "passed": bool,
                "violations": [{"keyword": str, "position": int}],
                "enforcement": "block" | "warn"
            }
        """
        violations: list[dict] = []
        for pattern, keyword in zip(self._keyword_patterns, self._blocked_keywords):
            match = pattern.search(text)
            if match:
                violations.append({"keyword": keyword, "position": match.start()})

        return {
            "passed": len(violations) == 0,
            "violations": violations,
            "enforcement": self._enforcement_mode,
        }

    def is_tool_restricted(self, tool_name: str) -> bool:
        """Return True if the tool is on the restricted list."""
        return tool_name.lower() in [t.lower() for t in self._restricted_tools]

    def evaluate_tool_call(self, tool_name: str) -> dict:
        """Check if a tool call is allowed by policy.

        Returns:
            {
                "allowed": bool,
                "reason": str | None,
                "enforcement": "block" | "warn"
            }
        """
        restricted = self.is_tool_restricted(tool_name)
        return {
            "allowed": not restricted,
            "reason": f"Tool '{tool_name}' is restricted by policy" if restricted else None,
            "enforcement": self._enforcement_mode,
        }

    @property
    def max_severity(self) -> int:
        return self._max_severity

    @property
    def enforcement_mode(self) -> str:
        return self._enforcement_mode

    @property
    def policy_summary(self) -> dict:
        """Return a summary of the loaded policy for diagnostics."""
        return {
            "blocked_keywords_count": len(self._blocked_keywords),
            "restricted_tools": self._restricted_tools,
            "max_severity": self._max_severity,
            "enforcement_mode": self._enforcement_mode,
        }
