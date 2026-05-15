"""
NEW FILE — safety/agent_guard.py
Non-invasive Agent Safety Wrapper.

Wraps any agent callable as a black box, applying safety checks
before and after execution without modifying agent internals.
"""

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from safety.config import SAFETY_LOG_PATH
from safety.prompt_injection import detect_prompt_injection
from safety.policy_engine import PolicyEngine
from safety.tool_validator import ToolValidator
from safety.task_adherence import score_task_adherence
from safety.context_drift import detect_context_drift


_REPO_ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Structured logger — writes JSON lines to logs/agent_safety.log
# ---------------------------------------------------------------------------
_safety_logger: logging.Logger | None = None


def _get_logger() -> logging.Logger:
    """Lazily initialize the safety audit logger."""
    global _safety_logger
    if _safety_logger is not None:
        return _safety_logger

    log_path = _REPO_ROOT / SAFETY_LOG_PATH
    log_path.parent.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger("agent_safety")
    logger.setLevel(logging.INFO)
    logger.propagate = False  # Don't pollute the root logger

    handler = logging.FileHandler(str(log_path), encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)

    _safety_logger = logger
    return logger


def _log_safety_event(event: dict) -> None:
    """Write a structured JSON event to the safety log."""
    logger = _get_logger()
    event["timestamp"] = datetime.now(timezone.utc).isoformat()
    logger.info(json.dumps(event, default=str))


class AgentSafetyWrapper:
    """Non-invasive wrapper that applies safety checks around any agent callable.

    The agent_callable is treated as a **black box** — its internals are
    never inspected or modified.

    Usage:
        wrapper = AgentSafetyWrapper(policy_engine, tool_validator)
        result = wrapper.run(user_input, my_agent_function)
    """

    def __init__(
        self,
        policy_engine: PolicyEngine | None = None,
        tool_validator: ToolValidator | None = None,
        original_task: str | None = None,
    ) -> None:
        self.policy_engine = policy_engine or PolicyEngine()
        self.tool_validator = tool_validator or ToolValidator()
        self.original_task = original_task  # For context drift tracking
        self._conversation_history: list[str] = []

    def run(
        self,
        user_input: str,
        agent_callable: Callable[[str], Any],
        tool_calls: list[dict] | None = None,
    ) -> dict:
        """Execute the agent with safety checks.

        Args:
            user_input:      The user's message / prompt.
            agent_callable:  Any function that accepts a string and returns a response.
                             Treated as a black box — DO NOT MODIFY IT.
            tool_calls:      Optional list of tool call dicts with "name" and "params" keys.

        Returns:
            {
                "response": <original agent response>,
                "safety": {
                    "injection_check": {...},
                    "policy_check": {...},
                    "tool_issues": [...],
                    "task_adherence": {...},
                    "context_drift": {...},
                    "overall_safe": bool
                }
            }
        """
        safety_metadata: dict[str, Any] = {}

        # ----- Step 1: Prompt injection check (pre-processing) -----
        injection_result = detect_prompt_injection(user_input)
        safety_metadata["injection_check"] = injection_result

        # ----- Step 1b: Policy check on input -----
        policy_result = self.policy_engine.evaluate_text(user_input)
        safety_metadata["policy_check"] = policy_result

        # ----- Step 2: Call original agent (BLACK BOX — do not modify) -----
        agent_response = agent_callable(user_input)

        # Normalize response to string for downstream checks
        response_text = str(agent_response) if agent_response is not None else ""

        # ----- Step 3: Validate tool usage (if tool info available) -----
        tool_issues: list[dict] = []
        if tool_calls:
            for call in tool_calls:
                tool_name = call.get("name", "unknown")
                tool_params = call.get("params", {})

                # Check policy restrictions
                policy_tool_check = self.policy_engine.evaluate_tool_call(tool_name)
                if not policy_tool_check["allowed"]:
                    tool_issues.append({
                        "tool": tool_name,
                        "source": "policy",
                        "issue": policy_tool_check["reason"],
                    })

                # Check registry validation
                registry_check = self.tool_validator.validate(tool_name, tool_params)
                if not registry_check["valid"]:
                    for issue in registry_check["issues"]:
                        tool_issues.append({
                            "tool": tool_name,
                            "source": "registry",
                            "issue": issue,
                        })

        safety_metadata["tool_issues"] = tool_issues

        # ----- Step 4: Task adherence scoring -----
        adherence = score_task_adherence(user_input, response_text)
        safety_metadata["task_adherence"] = adherence

        # ----- Step 4b: Context drift detection -----
        drift_result: dict = {}
        if self.original_task:
            drift_result = detect_context_drift(
                self.original_task,
                response_text,
                self._conversation_history if self._conversation_history else None,
            )
        safety_metadata["context_drift"] = drift_result

        # Track conversation for future drift detection
        self._conversation_history.append(user_input)
        self._conversation_history.append(response_text)

        # ----- Step 5: Overall safety determination -----
        overall_safe = (
            not injection_result["injection_detected"]
            and policy_result["passed"]
            and len(tool_issues) == 0
            and adherence["score"] >= 0.3
            and not drift_result.get("drifted", False)
        )
        safety_metadata["overall_safe"] = overall_safe

        # ----- Structured logging -----
        _log_safety_event({
            "input": user_input[:500],  # Truncate for log safety
            "output": response_text[:500],
            "safety": {
                "injection_detected": injection_result["injection_detected"],
                "injection_risk_level": injection_result["risk_level"],
                "policy_passed": policy_result["passed"],
                "task_score": adherence["score"],
                "tool_issues": tool_issues,
                "context_drifted": drift_result.get("drifted", False),
                "overall_safe": overall_safe,
            },
        })

        # ----- Return original response + safety metadata -----
        return {
            "response": agent_response,
            "safety": safety_metadata,
        }
