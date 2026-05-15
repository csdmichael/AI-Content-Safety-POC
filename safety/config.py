"""
NEW FILE — safety/config.py
Central configuration for the AI Agent Safety module.

All safety features are gated behind ENABLE_AGENT_SAFETY.
When False, none of the safety checks run and the original agent
callable is invoked directly with zero overhead.
"""

import os

# ---------------------------------------------------------------------------
# Feature flag — flip to True to activate agent safety checks.
# Can also be set via the ENABLE_AGENT_SAFETY environment variable.
# ---------------------------------------------------------------------------
ENABLE_AGENT_SAFETY: bool = os.environ.get("ENABLE_AGENT_SAFETY", "false").lower() == "true"

# Path to the global policy YAML (relative to repo root)
GLOBAL_POLICY_PATH: str = os.environ.get(
    "AGENT_SAFETY_POLICY_PATH",
    "policies/global_policy.yaml",
)

# Path to the tool registry JSON (relative to repo root)
TOOL_REGISTRY_PATH: str = os.environ.get(
    "AGENT_SAFETY_TOOL_REGISTRY_PATH",
    "policies/tool_registry.json",
)

# Log file for structured safety audit logs
SAFETY_LOG_PATH: str = os.environ.get(
    "AGENT_SAFETY_LOG_PATH",
    "logs/agent_safety.log",
)

# Task adherence: minimum keyword-overlap score to be considered "on-task"
TASK_ADHERENCE_THRESHOLD: float = float(
    os.environ.get("TASK_ADHERENCE_THRESHOLD", "0.3")
)

# Context drift: maximum allowed topic-shift ratio (0-1)
CONTEXT_DRIFT_THRESHOLD: float = float(
    os.environ.get("CONTEXT_DRIFT_THRESHOLD", "0.5")
)
