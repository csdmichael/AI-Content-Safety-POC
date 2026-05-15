"""
NEW FILE — safety/tool_validator.py
Tool validation module — validates tool calls against a JSON-based registry.

Warns (does not block) by default. Returns structured issues list.
"""

import json
from pathlib import Path
from typing import Any


_REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_registry(path: str) -> dict:
    """Load the tool registry JSON file."""
    full_path = _REPO_ROOT / path
    if not full_path.is_file():
        return {"allowed_tools": {}}
    return json.loads(full_path.read_text(encoding="utf-8"))


class ToolValidator:
    """Validates tool calls against an allow-list with expected parameters."""

    def __init__(self, registry_path: str | None = None) -> None:
        from safety.config import TOOL_REGISTRY_PATH
        path = registry_path or TOOL_REGISTRY_PATH
        self._registry = _load_registry(path)
        self._allowed_tools: dict[str, list[str]] = self._registry.get("allowed_tools", {})

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def validate(self, tool_name: str, params: dict[str, Any] | None = None) -> dict:
        """Validate a tool call.

        Args:
            tool_name: Name of the tool being invoked.
            params: Dictionary of parameters passed to the tool.

        Returns:
            {
                "valid": bool,
                "issues": [str],
                "severity": "warn" | "error"
            }
        """
        issues: list[str] = []
        params = params or {}

        # Check if tool is in the allow-list
        if tool_name not in self._allowed_tools:
            issues.append(f"Tool '{tool_name}' is not in the allowed tool registry.")
            return {"valid": False, "issues": issues, "severity": "warn"}

        allowed_params = self._allowed_tools[tool_name]

        # Check for unexpected parameters
        unexpected = [p for p in params if p not in allowed_params]
        if unexpected:
            issues.append(
                f"Unexpected parameter(s) for '{tool_name}': {', '.join(unexpected)}. "
                f"Allowed: {', '.join(allowed_params)}"
            )

        # Check for missing required parameters (all registered params treated as expected)
        missing = [p for p in allowed_params if p not in params]
        if missing:
            issues.append(
                f"Missing expected parameter(s) for '{tool_name}': {', '.join(missing)}"
            )

        # Check for empty/null values
        empty_vals = [k for k, v in params.items() if v is None or (isinstance(v, str) and not v.strip())]
        if empty_vals:
            issues.append(
                f"Empty or null value(s) for '{tool_name}': {', '.join(empty_vals)}"
            )

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "severity": "warn",  # warn by default — never blocks
        }

    def list_allowed_tools(self) -> dict[str, list[str]]:
        """Return the full allow-list for diagnostics."""
        return dict(self._allowed_tools)

    def is_known_tool(self, tool_name: str) -> bool:
        """Return True if the tool is in the registry."""
        return tool_name in self._allowed_tools
