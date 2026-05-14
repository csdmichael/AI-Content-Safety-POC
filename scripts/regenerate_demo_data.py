#!/usr/bin/env python3
"""Regenerate Cosmos DB content safety results with realistic mixed severity
scores across Hate, SelfHarm, Sexual, and Violence categories.

Produces a distribution of ~50 safe, ~25 review, ~25 blocked documents
so the UI demonstrates all content safety features."""

import json
import random
import re
from datetime import datetime, timezone
from pathlib import Path

from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential

REPO_ROOT = Path(__file__).resolve().parent.parent
CUSTOM_CATEGORY_PATTERNS = {
    "Profanity": [
        re.compile(r"\b(?:damn|hell|shit|f\*+k|fuck|bastard|idiot|moron)\b", re.IGNORECASE),
    ],
    "PII": [
        re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
        re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
        re.compile(r"\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b"),
        re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
    ],
}


def custom_category_analysis(text: str) -> list[dict]:
    normalized = text or ""
    return [
        {"category": category, "severity": 6 if any(p.search(normalized) for p in patterns) else 0}
        for category, patterns in CUSTOM_CATEGORY_PATTERNS.items()
    ]


def main() -> None:
    config = json.loads((REPO_ROOT / "config" / "azure-resources.json").read_text())
    manifest = json.loads((REPO_ROOT / "data" / "manifest.json").read_text())

    credential = DefaultAzureCredential()
    cosmos = CosmosClient(
        url=config["cosmosDb"]["privateEndpointUrl"],
        credential=credential,
    )
    container = (
        cosmos.get_database_client(config["cosmosDb"]["databaseName"])
        .get_container_client(config["cosmosDb"]["containerName"])
    )

    random.seed(42)  # reproducible
    categories = ["Hate", "SelfHarm", "Sexual", "Violence"]

    # Severity profiles by expected outcome
    SAFE_PROFILES = [
        {"Hate": 0, "SelfHarm": 0, "Sexual": 0, "Violence": 0},
        {"Hate": 0, "SelfHarm": 0, "Sexual": 2, "Violence": 0},
        {"Hate": 2, "SelfHarm": 0, "Sexual": 0, "Violence": 0},
        {"Hate": 0, "SelfHarm": 0, "Sexual": 0, "Violence": 2},
    ]

    BLOCKED_PROFILES = [
        {"Hate": 6, "SelfHarm": 0, "Sexual": 0, "Violence": 2},
        {"Hate": 0, "SelfHarm": 6, "Sexual": 0, "Violence": 0},
        {"Hate": 2, "SelfHarm": 0, "Sexual": 6, "Violence": 0},
        {"Hate": 0, "SelfHarm": 0, "Sexual": 0, "Violence": 6},
        {"Hate": 6, "SelfHarm": 4, "Sexual": 0, "Violence": 4},
        {"Hate": 4, "SelfHarm": 0, "Sexual": 4, "Violence": 6},
        {"Hate": 0, "SelfHarm": 6, "Sexual": 6, "Violence": 0},
        {"Hate": 6, "SelfHarm": 6, "Sexual": 6, "Violence": 6},
    ]

    REVIEW_PROFILES = [
        {"Hate": 2, "SelfHarm": 2, "Sexual": 0, "Violence": 2},
        {"Hate": 4, "SelfHarm": 0, "Sexual": 2, "Violence": 0},
        {"Hate": 0, "SelfHarm": 4, "Sexual": 0, "Violence": 2},
        {"Hate": 2, "SelfHarm": 0, "Sexual": 4, "Violence": 0},
        {"Hate": 0, "SelfHarm": 2, "Sexual": 0, "Violence": 4},
    ]

    REASONS = {
        "safe": [
            "No harmful content detected across any category.",
            "Content appears benign — all category severities are zero.",
            "Analysis complete — text and image pass all safety checks.",
            "Document content is within acceptable safety thresholds.",
        ],
        "review": [
            "Moderate severity detected — human review recommended.",
            "Borderline content flagged in one or more categories.",
            "Elevated severity suggests manual inspection before publishing.",
            "Content approaches safety threshold — review advised.",
        ],
        "blocked": [
            "High-severity harmful content detected — document blocked.",
            "Content exceeds safety threshold in multiple categories.",
            "Explicit harmful content identified — automatic block applied.",
            "Severe violations detected — content cannot be published.",
        ],
    }

    threshold = 4  # matches pipeline-settings
    stats = {"safe": 0, "review": 0, "blocked": 0}

    for doc in manifest["documents"]:
        expected = doc["expectedContentSafetyOutcome"]

        if expected == "pass":
            profile = random.choice(SAFE_PROFILES)
            decision_cat = "safe"
        else:
            # ~50% blocked, ~50% review among the "fail" docs
            if random.random() < 0.5:
                profile = random.choice(BLOCKED_PROFILES)
                decision_cat = "blocked"
            else:
                profile = random.choice(REVIEW_PROFILES)
                decision_cat = "review"

        cats_analysis = [{"category": c, "severity": profile[c]} for c in categories]
        custom_analysis = custom_category_analysis(doc.get("seedText", ""))
        custom_max = max((c["severity"] for c in custom_analysis), default=0)
        max_sev = max(max(profile.values()), custom_max)
        text_decision = "blocked" if max_sev >= threshold else "safe"

        # For images, add a secondary analysis with slight variation
        image_formats = {"png", "jpg"}
        is_image = doc["format"] in image_formats
        image_decision = None
        image_max = None
        image_analysis = None
        if is_image:
            img_profile = {c: max(0, profile[c] + random.choice([-2, 0, 0, 0])) for c in categories}
            img_cats = [{"category": c, "severity": img_profile[c]} for c in categories]
            image_max = max(img_profile.values())
            image_decision = "blocked" if image_max >= threshold else "safe"
            image_analysis = {"categoriesAnalysis": img_cats}

        reason = random.choice(REASONS[decision_cat])

        record = {
            "id": doc["id"],
            "fileName": doc["fileName"],
            "format": doc["format"],
            "blobUrl": f"https://aistoragemyaacoub.blob.core.windows.net/content-safety-documents/{doc['fileName']}",
            "expectedContentSafetyOutcome": expected,
            "textAnalysisDecision": text_decision,
            "textMaxSeverity": max_sev,
            "textAnalysis": {"categoriesAnalysis": cats_analysis},
            "customCategoryAnalysis": custom_analysis,
            "imageAnalysisDecision": image_decision,
            "imageMaxSeverity": image_max,
            "imageAnalysis": image_analysis,
            "processedAtUtc": datetime.now(timezone.utc).isoformat(),
        }

        container.upsert_item(record)
        stats[decision_cat] += 1
        print(f"  {doc['fileName']:20s}  expected={expected:4s}  actual={decision_cat:8s}  maxSev={max_sev}")

    print(f"\nDone — safe: {stats['safe']}, review: {stats['review']}, blocked: {stats['blocked']}")


if __name__ == "__main__":
    main()
