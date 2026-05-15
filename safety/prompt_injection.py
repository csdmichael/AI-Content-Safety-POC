"""
NEW FILE — safety/agent_guard.py
Prompt injection detection — keyword heuristic with structured output.

Designed so it can later be swapped for Azure AI Content Safety integration.
"""

import re
from typing import Any


# ---------------------------------------------------------------------------
# Heuristic patterns for common prompt injection attempts
# ---------------------------------------------------------------------------
_INJECTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("ignore_instructions", re.compile(
        r"ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|guidelines?)",
        re.IGNORECASE,
    )),
    ("override_system", re.compile(
        r"override\s+(system|safety|security|admin)\s*(prompt|message|instructions?|settings?)?",
        re.IGNORECASE,
    )),
    ("new_instructions", re.compile(
        r"(new|updated?|revised?|replacement?)\s+instructions?\s*:",
        re.IGNORECASE,
    )),
    ("role_switch", re.compile(
        r"(you\s+are\s+now|act\s+as|pretend\s+(to\s+be|you\s+are)|role[\s-]?play\s+as)",
        re.IGNORECASE,
    )),
    ("system_prompt_leak", re.compile(
        r"(show|reveal|display|print|output|repeat)\s+(your\s+)?(system\s+)?(prompt|instructions?|rules?)",
        re.IGNORECASE,
    )),
    ("jailbreak_attempt", re.compile(
        r"(DAN|do\s+anything\s+now|developer\s+mode|god\s+mode|unrestricted\s+mode)",
        re.IGNORECASE,
    )),
    ("encoding_evasion", re.compile(
        r"(base64|rot13|hex[\s-]?encode|url[\s-]?encode)\s*(this|the|my|following)?",
        re.IGNORECASE,
    )),
    ("delimiter_injection", re.compile(
        r"(###|```|<\|im_start\|>|<\|im_end\|>|\[INST\]|\[/INST\]|<system>|</system>)",
        re.IGNORECASE,
    )),
]


def detect_prompt_injection(text: str) -> dict:
    """Detect potential prompt injection attempts in input text.

    Uses keyword/regex heuristics. Structured output is designed to be
    compatible with future Azure AI Content Safety integration.

    Args:
        text: The user input or message to evaluate.

    Returns:
        {
            "injection_detected": bool,
            "confidence": float (0-1),
            "matched_patterns": [{"pattern_name": str, "matched_text": str}],
            "risk_level": "none" | "low" | "medium" | "high",
            "recommendation": str
        }
    """
    if not text or not text.strip():
        return {
            "injection_detected": False,
            "confidence": 0.0,
            "matched_patterns": [],
            "risk_level": "none",
            "recommendation": "No input to evaluate.",
        }

    matches: list[dict[str, str]] = []
    for pattern_name, pattern in _INJECTION_PATTERNS:
        found = pattern.search(text)
        if found:
            matches.append({
                "pattern_name": pattern_name,
                "matched_text": found.group(0),
            })

    # Calculate confidence based on number and severity of matches
    match_count = len(matches)
    if match_count == 0:
        confidence = 0.0
        risk_level = "none"
        recommendation = "No injection patterns detected."
    elif match_count == 1:
        confidence = 0.4
        risk_level = "low"
        recommendation = "Single pattern match — may be benign. Review context."
    elif match_count == 2:
        confidence = 0.7
        risk_level = "medium"
        recommendation = "Multiple pattern matches — likely injection attempt. Flag for review."
    else:
        confidence = min(0.95, 0.5 + match_count * 0.15)
        risk_level = "high"
        recommendation = "Strong injection signal — consider blocking this input."

    return {
        "injection_detected": match_count > 0,
        "confidence": round(confidence, 2),
        "matched_patterns": matches,
        "risk_level": risk_level,
        "recommendation": recommendation,
    }
