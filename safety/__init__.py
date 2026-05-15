"""
NEW FILE — safety/__init__.py
AI Agent Safety module — all exports.

This module provides agent safety capabilities including:
- Prompt injection detection
- Tool validation
- Task adherence scoring
- Context drift detection
- Centralized policy enforcement
- Agent safety wrapper (non-invasive)

All features are gated behind ENABLE_AGENT_SAFETY in safety/config.py.
"""

from safety.config import ENABLE_AGENT_SAFETY

__all__ = [
    "ENABLE_AGENT_SAFETY",
]
