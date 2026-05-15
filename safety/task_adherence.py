"""
NEW FILE — safety/task_adherence.py
Lightweight task adherence scoring — deterministic keyword heuristic.

Compares keywords from user input vs agent response and returns a
relevance score (0–1) plus a list of issues. No ML required.
"""

import re
import string
from collections import Counter


# Common English stop words to exclude from keyword comparison
_STOP_WORDS = frozenset({
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "it", "its", "was", "are", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "shall", "can", "this",
    "that", "these", "those", "i", "you", "he", "she", "we", "they",
    "me", "him", "her", "us", "them", "my", "your", "his", "our",
    "their", "what", "which", "who", "whom", "how", "when", "where",
    "why", "not", "no", "yes", "if", "then", "so", "as", "just",
    "about", "up", "out", "all", "also", "very", "too", "more",
})


def _extract_keywords(text: str) -> set[str]:
    """Extract meaningful keywords from text (lowercase, no stop words)."""
    # Remove punctuation and split
    cleaned = text.lower().translate(str.maketrans("", "", string.punctuation))
    tokens = cleaned.split()
    # Filter stop words and very short tokens
    return {t for t in tokens if t not in _STOP_WORDS and len(t) > 2}


def score_task_adherence(user_input: str, agent_response: str) -> dict:
    """Score how well the agent response adheres to the user's task.

    Uses keyword overlap as a simple relevance heuristic:
    - Extracts meaningful keywords from both input and response
    - Calculates overlap ratio
    - Flags issues when overlap is low

    Args:
        user_input:     The original user prompt / task description.
        agent_response: The agent's textual response.

    Returns:
        {
            "score": float (0-1),
            "input_keywords": [str],
            "response_keywords": [str],
            "matched_keywords": [str],
            "issues": [str]
        }
    """
    from safety.config import TASK_ADHERENCE_THRESHOLD

    input_kw = _extract_keywords(user_input)
    response_kw = _extract_keywords(agent_response)

    if not input_kw:
        return {
            "score": 1.0,
            "input_keywords": [],
            "response_keywords": sorted(response_kw),
            "matched_keywords": [],
            "issues": [],
        }

    matched = input_kw & response_kw
    score = len(matched) / len(input_kw) if input_kw else 0.0

    issues: list[str] = []

    if score < TASK_ADHERENCE_THRESHOLD:
        issues.append(
            f"Low task adherence ({score:.2f}): response may not address the user's request. "
            f"Only {len(matched)}/{len(input_kw)} input keywords found in response."
        )

    # Check if response is suspiciously short
    if len(agent_response.split()) < 5 and len(user_input.split()) > 10:
        issues.append("Response is very short relative to the input — possible incomplete answer.")

    # Check if response is excessively long (potential over-generation)
    response_word_count = len(agent_response.split())
    input_word_count = len(user_input.split())
    if response_word_count > input_word_count * 20 and response_word_count > 500:
        issues.append("Response is excessively long relative to input — possible over-generation.")

    return {
        "score": round(score, 4),
        "input_keywords": sorted(input_kw),
        "response_keywords": sorted(response_kw),
        "matched_keywords": sorted(matched),
        "issues": issues,
    }
