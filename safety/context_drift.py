"""
NEW FILE — safety/context_drift.py
Context drift detection — basic heuristic to detect topic shift.

Compares the topic distribution of the current turn against the
original task to flag potential context drift / derailment.
"""

import re
import string
from collections import Counter


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


def _tokenize(text: str) -> list[str]:
    """Lowercase, strip punctuation, remove stop words."""
    cleaned = text.lower().translate(str.maketrans("", "", string.punctuation))
    return [t for t in cleaned.split() if t not in _STOP_WORDS and len(t) > 2]


def _cosine_similarity(counter_a: Counter, counter_b: Counter) -> float:  # type: ignore[type-arg]
    """Compute cosine similarity between two term-frequency counters."""
    if not counter_a or not counter_b:
        return 0.0
    common_keys = set(counter_a.keys()) & set(counter_b.keys())
    dot = sum(counter_a[k] * counter_b[k] for k in common_keys)
    mag_a = sum(v * v for v in counter_a.values()) ** 0.5
    mag_b = sum(v * v for v in counter_b.values()) ** 0.5
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def detect_context_drift(
    original_task: str,
    current_text: str,
    conversation_history: list[str] | None = None,
) -> dict:
    """Detect whether the current text has drifted from the original task.

    Uses term-frequency cosine similarity as a lightweight heuristic.

    Args:
        original_task:        The user's original task / system prompt.
        current_text:         The latest agent response or user turn.
        conversation_history: Optional list of previous turns for trend analysis.

    Returns:
        {
            "drift_score": float (0-1, higher = more drift),
            "similarity": float (0-1, higher = more similar),
            "drifted": bool,
            "issues": [str]
        }
    """
    from safety.config import CONTEXT_DRIFT_THRESHOLD

    task_tokens = _tokenize(original_task)
    current_tokens = _tokenize(current_text)

    task_freq = Counter(task_tokens)
    current_freq = Counter(current_tokens)

    similarity = _cosine_similarity(task_freq, current_freq)
    drift_score = round(1.0 - similarity, 4)
    drifted = drift_score > CONTEXT_DRIFT_THRESHOLD

    issues: list[str] = []

    if drifted:
        issues.append(
            f"Context drift detected (drift={drift_score:.2f}, similarity={similarity:.2f}). "
            f"The response may have diverged from the original task."
        )

    # If conversation history is provided, check for progressive drift
    if conversation_history and len(conversation_history) >= 3:
        recent_tokens = _tokenize(" ".join(conversation_history[-3:]))
        recent_freq = Counter(recent_tokens)
        recent_sim = _cosine_similarity(task_freq, recent_freq)
        if recent_sim < 0.2:
            issues.append(
                f"Progressive drift detected: last 3 turns have very low similarity "
                f"({recent_sim:.2f}) to the original task."
            )

    # Check for new dominant topics not in original task
    if current_tokens:
        task_set = set(task_tokens)
        new_tokens = [t for t in current_tokens if t not in task_set]
        new_freq = Counter(new_tokens)
        if new_freq:
            top_new = new_freq.most_common(3)
            dominant_new = [w for w, c in top_new if c > 2]
            if dominant_new:
                issues.append(
                    f"New dominant topics not in original task: {', '.join(dominant_new)}"
                )

    return {
        "drift_score": drift_score,
        "similarity": round(similarity, 4),
        "drifted": drifted,
        "issues": issues,
    }
