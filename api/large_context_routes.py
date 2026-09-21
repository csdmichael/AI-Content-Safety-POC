"""FastAPI router providing REST endpoints for handling large context (large files/text).

This is a demonstration of how a customer can handle:
1. Large images (> 4MB) by dynamically resizing and compressing them before submission.
2. Large text (> 10,000 characters) by chunking with an overlap, evaluating each chunk, and aggregating decisions.
3. APIM policies for rate limiting, size limiting, caching, and load balancing.
"""

from __future__ import annotations

import asyncio
import base64
import concurrent.futures
import io
import json
import logging
import os
import re
from time import perf_counter, sleep
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
import httpx
from azure.identity import DefaultAzureCredential
from PIL import Image, ImageOps

# Setup logging
logger = logging.getLogger("large_context")
logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# Configuration (derived from the environment or falling back)
# ---------------------------------------------------------------------------
CONTENT_SAFETY_ENDPOINT = os.environ.get("CONTENT_SAFETY_ENDPOINT", "").rstrip("/")
CONTENT_SAFETY_API_VERSION = os.environ.get("CONTENT_SAFETY_API_VERSION", "2024-09-01")
CONTENT_SAFETY_MULTIMODAL_API_VERSION = os.environ.get(
    "CONTENT_SAFETY_MULTIMODAL_API_VERSION", "2024-09-15-preview"
)
SEVERITY_THRESHOLD = int(os.environ.get("SEVERITY_THRESHOLD", "4"))
CONTENT_SAFETY_MOCK_MODE = os.environ.get("CONTENT_SAFETY_MOCK_MODE", "false").lower() == "true"
CONTENT_SAFETY_BLOCKLISTS = [
    name.strip()
    for name in os.environ.get("CONTENT_SAFETY_BLOCKLISTS", "").split(",")
    if name.strip()
]
TEXT_WINDOW_MAX_CHARS = 10_000
TEXT_WINDOW_MIN_CHARS = 100
MAX_TEXT_WINDOWS = min(256, max(1, int(os.environ.get("MAX_TEXT_WINDOWS", "64"))))
MAX_CONTENT_SAFETY_CALLS = min(
    512, max(1, int(os.environ.get("MAX_CONTENT_SAFETY_CALLS", "128")))
)
IMAGE_MAX_BYTES = 4 * 1024 * 1024
IMAGE_MIN_DIMENSION = 50
IMAGE_MAX_DIMENSION = 7_200
IMAGE_ANALYSIS_MIN_DIMENSION = 1_024
IMAGE_MIN_QUALITY = 60
MAX_IMAGE_UPLOAD_BYTES = int(os.environ.get("MAX_IMAGE_UPLOAD_BYTES", str(32 * 1024 * 1024)))
MAX_IMAGE_PIXELS = int(os.environ.get("MAX_IMAGE_PIXELS", "40000000"))
MAX_LARGE_TEXT_CHARS = int(os.environ.get("MAX_LARGE_TEXT_CHARS", "1000000"))
MAX_PARALLEL_SCANS = min(16, max(1, int(os.environ.get("MAX_PARALLEL_SCANS", "4"))))
CONTENT_SAFETY_RETRY_ATTEMPTS = min(
    5, max(1, int(os.environ.get("CONTENT_SAFETY_RETRY_ATTEMPTS", "3")))
)
MAX_MODERATION_DURATION_SECONDS = min(
    55.0, max(5.0, float(os.environ.get("MAX_MODERATION_DURATION_SECONDS", "45")))
)
MAX_CONCURRENT_IMAGE_JOBS = min(
    4, max(1, int(os.environ.get("MAX_CONCURRENT_IMAGE_JOBS", "2")))
)
IMAGE_QUEUE_TIMEOUT_SECONDS = min(
    10.0, max(0.1, float(os.environ.get("IMAGE_QUEUE_TIMEOUT_SECONDS", "2")))
)
CATEGORY_THRESHOLDS = {
    "Hate": int(os.environ.get("HATE_SEVERITY_THRESHOLD", str(SEVERITY_THRESHOLD))),
    "SelfHarm": int(os.environ.get("SELF_HARM_SEVERITY_THRESHOLD", str(SEVERITY_THRESHOLD))),
    "Sexual": int(os.environ.get("SEXUAL_SEVERITY_THRESHOLD", str(SEVERITY_THRESHOLD))),
    "Violence": int(os.environ.get("VIOLENCE_SEVERITY_THRESHOLD", str(SEVERITY_THRESHOLD))),
}

credential = DefaultAzureCredential()
_content_safety_client = httpx.Client(
    limits=httpx.Limits(
        max_connections=MAX_PARALLEL_SCANS * 2,
        max_keepalive_connections=MAX_PARALLEL_SCANS,
    )
)
_image_job_limiter = asyncio.Semaphore(MAX_CONCURRENT_IMAGE_JOBS)

# Cache token locally to avoid fetching on every request chunk
_token_cache = {"token": None, "expires_at": 0}

def _get_auth_token() -> str:
    now = datetime.now(timezone.utc).timestamp()
    if _token_cache["token"] and _token_cache["expires_at"] > now + 60:
        return _token_cache["token"]
    try:
        token_obj = credential.get_token("https://cognitiveservices.azure.com/.default")
        _token_cache["token"] = token_obj.token
        _token_cache["expires_at"] = token_obj.expires_on
        return token_obj.token
    except Exception as exc:
        if CONTENT_SAFETY_MOCK_MODE:
            logger.warning("Azure credential unavailable; using explicit mock mode: %s", exc)
            return "mock_bearer_token"
        raise HTTPException(status_code=503, detail="Content Safety authentication failed.") from exc

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
large_context_router = APIRouter(prefix="/api/large-context", tags=["Large Context Handling"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _post_content_safety(
    url: str,
    headers: dict,
    payload: dict,
    timeout: float,
    operation: str,
    deadline: float | None = None,
) -> dict:
    """POST to Content Safety with pooled connections and bounded transient retries."""
    retryable_statuses = {429, 500, 502, 503, 504}
    last_error: httpx.HTTPError | None = None

    for attempt in range(CONTENT_SAFETY_RETRY_ATTEMPTS):
        remaining_seconds = deadline - perf_counter() if deadline is not None else timeout
        if remaining_seconds <= 0:
            raise HTTPException(status_code=504, detail="Content Safety moderation deadline exceeded.")
        try:
            response = _content_safety_client.post(
                url,
                headers=headers,
                json=payload,
                timeout=min(timeout, max(0.1, remaining_seconds)),
            )
            if response.status_code in retryable_statuses and attempt + 1 < CONTENT_SAFETY_RETRY_ATTEMPTS:
                retry_after = response.headers.get("Retry-After", "")
                try:
                    delay_seconds = min(5.0, max(0.0, float(retry_after)))
                except ValueError:
                    delay_seconds = min(2.0, 0.25 * (2 ** attempt))
                if deadline is not None:
                    delay_seconds = min(delay_seconds, max(0.0, deadline - perf_counter()))
                if delay_seconds <= 0:
                    raise HTTPException(status_code=504, detail="Content Safety moderation deadline exceeded.")
                sleep(delay_seconds)
                continue

            response.raise_for_status()
            try:
                result = response.json()
            except ValueError as exc:
                raise HTTPException(
                    status_code=502,
                    detail=f"Content Safety {operation} returned invalid JSON.",
                ) from exc
            if not isinstance(result, dict):
                raise HTTPException(
                    status_code=502,
                    detail=f"Content Safety {operation} returned an invalid response.",
                )
            return result
        except httpx.HTTPError as exc:
            last_error = exc
            status_code = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
            if attempt + 1 < CONTENT_SAFETY_RETRY_ATTEMPTS and (
                status_code in retryable_statuses or isinstance(exc, httpx.RequestError)
            ):
                delay_seconds = min(2.0, 0.25 * (2 ** attempt))
                if deadline is not None:
                    delay_seconds = min(delay_seconds, max(0.0, deadline - perf_counter()))
                if delay_seconds <= 0:
                    raise HTTPException(status_code=504, detail="Content Safety moderation deadline exceeded.")
                sleep(delay_seconds)
                continue
            break

    if deadline is not None and perf_counter() >= deadline:
        raise HTTPException(status_code=504, detail="Content Safety moderation deadline exceeded.") from last_error
    logger.error("Azure Content Safety %s failed: %s", operation, last_error)
    raise HTTPException(status_code=502, detail=f"Content Safety {operation} failed.") from last_error


def _validate_categories_response(result: dict, operation: str) -> None:
    categories = result.get("categoriesAnalysis")
    if not isinstance(categories, list):
        raise HTTPException(
            status_code=502,
            detail=f"Content Safety {operation} omitted category analysis.",
        )

    expected_categories = {"Hate", "SelfHarm", "Sexual", "Violence"}
    returned_categories: set[str] = set()
    for item in categories:
        if not isinstance(item, dict):
            raise HTTPException(status_code=502, detail=f"Content Safety {operation} returned invalid categories.")
        category = item.get("category")
        severity = item.get("severity")
        if (
            not isinstance(category, str)
            or type(severity) is not int
            or severity not in {0, 2, 4, 6}
        ):
            raise HTTPException(status_code=502, detail=f"Content Safety {operation} returned invalid categories.")
        returned_categories.add(category)

    if not expected_categories.issubset(returned_categories):
        raise HTTPException(
            status_code=502,
            detail=f"Content Safety {operation} returned incomplete category analysis.",
        )

    blocklist_matches = result.get("blocklistsMatch", [])
    if not isinstance(blocklist_matches, list):
        raise HTTPException(status_code=502, detail=f"Content Safety {operation} returned invalid blocklist matches.")


def _validate_prompt_shield_response(result: dict, content_source: str) -> None:
    user_analysis = result.get("userPromptAnalysis")
    document_analyses = result.get("documentsAnalysis")
    if (
        not isinstance(user_analysis, dict)
        or not isinstance(user_analysis.get("attackDetected"), bool)
        or not isinstance(document_analyses, list)
        or any(
            not isinstance(item, dict) or not isinstance(item.get("attackDetected"), bool)
            for item in document_analyses
        )
        or (content_source == "retrieved_document" and len(document_analyses) != 1)
    ):
        raise HTTPException(
            status_code=502,
            detail="Content Safety Prompt Shields returned an incomplete response.",
        )


def _call_content_safety_text(text: str, deadline: float | None = None) -> dict:
    """Call Content Safety API for a single text chunk."""
    if CONTENT_SAFETY_MOCK_MODE:
        return _get_mock_text_analysis(text)

    if not CONTENT_SAFETY_ENDPOINT:
        raise HTTPException(status_code=503, detail="CONTENT_SAFETY_ENDPOINT is not configured.")

    token = _get_auth_token()
    url = f"{CONTENT_SAFETY_ENDPOINT}/contentsafety/text:analyze?api-version={CONTENT_SAFETY_API_VERSION}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    
    payload: dict = {"text": text, "outputType": "FourSeverityLevels"}
    if CONTENT_SAFETY_BLOCKLISTS:
        payload["blocklistNames"] = CONTENT_SAFETY_BLOCKLISTS
        payload["haltOnBlocklistHit"] = False

    result = _post_content_safety(url, headers, payload, 20, "text analysis", deadline)
    _validate_categories_response(result, "text analysis")
    return result

def _get_mock_text_analysis(text: str) -> dict:
    """Helper to mock Text Content Safety behavior based on keywords for offline demo/test."""
    violations = []
    # Check for profanity and block triggers in text
    profanity_pattern = re.compile(r"\b(?:damn|hell(?:scape)?|shit|f\*+k|fuck|bastard|idiots?|moron)\b", re.IGNORECASE)
    pii_pattern = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
    
    max_severity = 0
    categories = [
        {"category": "Hate", "severity": 0},
        {"category": "SelfHarm", "severity": 0},
        {"category": "Sexual", "severity": 0},
        {"category": "Violence", "severity": 0}
    ]
    
    if profanity_pattern.search(text):
        categories.append({"category": "Profanity", "severity": 6})
        max_severity = 6
    if pii_pattern.search(text):
        categories.append({"category": "PII", "severity": 6})
        max_severity = 6
        
    # Check for typical jailbreak or explicit terms for mock testing
    if "kill" in text.lower() or "bomb" in text.lower() or "murder" in text.lower():
        categories[3]["severity"] = 6  # Violence
        max_severity = max(max_severity, 6)
    if "hate" in text.lower() or "racist" in text.lower():
        categories[0]["severity"] = 4  # Hate
        max_severity = max(max_severity, 4)
        
    return {
        "categoriesAnalysis": categories
    }


def _call_prompt_shield(
    text: str,
    content_source: str,
    user_prompt: str | None,
    deadline: float | None = None,
) -> dict:
    """Check one user-prompt or retrieved-document window for prompt attacks."""
    if content_source == "model_completion":
        return {"applied": False, "attack_detected": False}

    if CONTENT_SAFETY_MOCK_MODE:
        attack_pattern = re.compile(
            r"ignore (?:all |the )?(?:previous|prior) instructions|system prompt|do anything now",
            re.IGNORECASE,
        )
        return {
            "applied": True,
            "attack_detected": bool(attack_pattern.search(text)),
        }

    if not CONTENT_SAFETY_ENDPOINT:
        raise HTTPException(status_code=503, detail="CONTENT_SAFETY_ENDPOINT is not configured.")

    token = _get_auth_token()
    url = f"{CONTENT_SAFETY_ENDPOINT}/contentsafety/text:shieldPrompt?api-version={CONTENT_SAFETY_API_VERSION}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    if content_source == "retrieved_document":
        payload = {
            "userPrompt": user_prompt or "Evaluate the supplied document for prompt attacks.",
            "documents": [text],
        }
    else:
        payload = {"userPrompt": text, "documents": []}

    result = _post_content_safety(
        url,
        headers,
        payload,
        20,
        "Prompt Shields analysis",
        deadline,
    )
    _validate_prompt_shield_response(result, content_source)

    user_attack = result.get("userPromptAnalysis", {}).get("attackDetected", False)
    document_attack = any(
        item.get("attackDetected", False)
        for item in result.get("documentsAnalysis", [])
    )
    return {
        "applied": True,
        "attack_detected": bool(user_attack or document_attack),
    }


def _chunk_text_semantically(text: str, chunk_size: int, overlap: int) -> list[dict]:
    """Split text at nearby natural boundaries while retaining character overlap."""
    chunks: list[dict] = []
    start = 0
    index = 0
    text_length = len(text)

    while start < text_length:
        hard_end = min(start + chunk_size, text_length)
        end = hard_end
        if hard_end < text_length:
            search_start = max(start + overlap + 1, hard_end - min(1_000, chunk_size // 3))
            for boundary in ("\n\n", "\n", ". ", "! ", "? ", " "):
                boundary_index = text.rfind(boundary, search_start, hard_end)
                if boundary_index >= search_start:
                    end = boundary_index + len(boundary)
                    break

        chunks.append(
            {
                "index": index,
                "text": text[start:end],
                "start": start,
                "end": end,
            }
        )
        if len(chunks) > MAX_TEXT_WINDOWS:
            raise HTTPException(
                status_code=413,
                detail=f"Text requires more than the configured {MAX_TEXT_WINDOWS} moderation windows.",
            )
        if end >= text_length:
            break

        start = max(start + 1, end - overlap)
        index += 1

    return chunks


def _analysis_decision(analysis: dict) -> tuple[int, list[str], list[str], bool]:
    _validate_categories_response(analysis, "analysis")
    categories = analysis.get("categoriesAnalysis", [])
    max_severity = max((item.get("severity", 0) for item in categories), default=0)
    flagged_categories = [
        f"{item.get('category', 'Unknown')} ({item.get('severity', 0)})"
        for item in categories
        if item.get("severity", 0) > 0
    ]
    blocklist_matches = [
        item.get("blocklistName", "configured blocklist")
        for item in analysis.get("blocklistsMatch", [])
    ]
    category_blocked = any(
        item.get("severity", 0)
        >= CATEGORY_THRESHOLDS.get(item.get("category", ""), SEVERITY_THRESHOLD)
        for item in categories
    )
    return max_severity, flagged_categories, blocklist_matches, bool(category_blocked or blocklist_matches)

def _call_content_safety_image(image_bytes: bytes, deadline: float | None = None) -> dict:
    """Call multimodal Content Safety so rendered text is included via OCR."""
    if CONTENT_SAFETY_MOCK_MODE:
        return _get_mock_image_analysis()

    if not CONTENT_SAFETY_ENDPOINT:
        raise HTTPException(status_code=503, detail="CONTENT_SAFETY_ENDPOINT is not configured.")

    token = _get_auth_token()
    url = (
        f"{CONTENT_SAFETY_ENDPOINT}/contentsafety/imageWithText:analyze"
        f"?api-version={CONTENT_SAFETY_MULTIMODAL_API_VERSION}"
    )
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    b64 = base64.b64encode(image_bytes).decode()
    
    result = _post_content_safety(
        url,
        headers,
        {
            "image": {"content": b64},
            "categories": ["Hate", "SelfHarm", "Sexual", "Violence"],
            "enableOcr": True,
        },
        30,
        "image analysis",
        deadline,
    )
    _validate_categories_response(result, "image analysis")
    return result

def _get_mock_image_analysis() -> dict:
    """Mock Image Content Safety response."""
    return {
        "categoriesAnalysis": [
            {"category": "Hate", "severity": 0},
            {"category": "SelfHarm", "severity": 0},
            {"category": "Sexual", "severity": 0},
            {"category": "Violence", "severity": 0}
        ]
    }

# ---------------------------------------------------------------------------
# API Models
# ---------------------------------------------------------------------------
class ChunkResult(BaseModel):
    index: int
    text_preview: str
    start_char: int
    end_char: int
    severity: int
    decision: str
    flagged_categories: list[str]
    blocklist_matches: list[str]
    prompt_shield_applied: bool
    prompt_attack_detected: bool
    scan_duration_ms: float

class TextLargeContextResponse(BaseModel):
    original_length: int
    chunk_size: int
    overlap: int
    num_chunks: int
    chunks: list[ChunkResult]
    aggregated_decision: str
    max_severity: int
    flagged_categories: list[str]
    content_source: str
    prompt_shield_enabled: bool
    prompt_attack_detected: bool
    parallelism: int
    moderation_duration_ms: float
    processed_at_utc: str

class ImageCompressionMetrics(BaseModel):
    original_size_bytes: int
    original_dimensions: str
    original_format: str
    compressed_size_bytes: int
    compressed_dimensions: str
    compressed_format: str
    resized: bool
    final_quality: int
    reduction_percentage: float

class ImageLargeContextResponse(BaseModel):
    metrics: ImageCompressionMetrics
    max_severity: int
    decision: str
    flagged_categories: list[str]
    ocr_enabled: bool
    ocr_character_limit: int
    moderation_duration_ms: float
    processed_at_utc: str

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@large_context_router.post(
    "/analyze-text",
    response_model=TextLargeContextResponse,
    summary="Chunk large text with overlap, analyze each chunk, and aggregate decisions"
)
def analyze_large_text(
    text: str = Form(...),
    chunk_size: int = Form(8000),
    overlap: int = Form(1000),
    content_source: Literal["user_prompt", "retrieved_document", "model_completion"] = Form("user_prompt"),
    prompt_shield: bool = Form(True),
    user_prompt: str | None = Form(None),
):
    started_at = perf_counter()
    deadline = started_at + MAX_MODERATION_DURATION_SECONDS
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")
    if len(text) > MAX_LARGE_TEXT_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"Text exceeds the configured {MAX_LARGE_TEXT_CHARS:,}-character request limit.",
        )
    if chunk_size < TEXT_WINDOW_MIN_CHARS or chunk_size > TEXT_WINDOW_MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Chunk size must be between {TEXT_WINDOW_MIN_CHARS:,} "
                f"and {TEXT_WINDOW_MAX_CHARS:,} characters."
            ),
        )
    if overlap < 0:
        raise HTTPException(status_code=400, detail="Overlap cannot be negative.")
    if overlap >= chunk_size:
        raise HTTPException(status_code=400, detail="Overlap must be less than chunk size.")
    if overlap > chunk_size // 2:
        raise HTTPException(status_code=400, detail="Overlap cannot exceed half of the chunk size.")
    if content_source == "retrieved_document" and user_prompt and len(user_prompt) > TEXT_WINDOW_MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Prompt Shields user prompt cannot exceed {TEXT_WINDOW_MAX_CHARS:,} characters.",
        )

    text_len = len(text)
    chunks = _chunk_text_semantically(text, chunk_size, overlap)
    calls_per_window = 2 if prompt_shield and content_source != "model_completion" else 1
    required_calls = len(chunks) * calls_per_window
    if required_calls > MAX_CONTENT_SAFETY_CALLS:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Request requires {required_calls} Content Safety calls, above the configured "
                f"budget of {MAX_CONTENT_SAFETY_CALLS}. Increase the window size or split the request."
            ),
        )
    worker_count = min(MAX_PARALLEL_SCANS, len(chunks))

    def analyze_chunk(chunk: dict) -> ChunkResult:
        chunk_started_at = perf_counter()
        cs_res = _call_content_safety_text(chunk["text"], deadline)
        chunk_max_severity, flagged_categories, blocklist_matches, content_blocked = (
            _analysis_decision(cs_res)
        )
        shield_result = (
            _call_prompt_shield(chunk["text"], content_source, user_prompt, deadline)
            if prompt_shield
            else {"applied": False, "attack_detected": False}
        )
        blocked = content_blocked or shield_result["attack_detected"]

        preview = chunk["text"]
        if len(preview) > 150:
            preview = preview[:75] + " [...] " + preview[-75:]

        return ChunkResult(
            index=chunk["index"],
            text_preview=preview,
            start_char=chunk["start"],
            end_char=chunk["end"],
            severity=chunk_max_severity,
            decision="blocked" if blocked else "safe",
            flagged_categories=flagged_categories,
            blocklist_matches=blocklist_matches,
            prompt_shield_applied=shield_result["applied"],
            prompt_attack_detected=shield_result["attack_detected"],
            scan_duration_ms=round((perf_counter() - chunk_started_at) * 1_000, 2),
        )

    chunk_results: list[ChunkResult | None] = [None] * len(chunks)
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=worker_count)
    futures: dict[concurrent.futures.Future[ChunkResult], int] = {}
    try:
        futures = {executor.submit(analyze_chunk, chunk): chunk["index"] for chunk in chunks}
        for future in concurrent.futures.as_completed(futures):
            chunk_results[futures[future]] = future.result()
    except Exception:
        for future in futures:
            future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
        raise
    else:
        executor.shutdown(wait=True)

    completed_results = [result for result in chunk_results if result is not None]
    global_max_severity = max((result.severity for result in completed_results), default=0)
    global_decision = (
        "blocked" if any(result.decision == "blocked" for result in completed_results) else "safe"
    )
    prompt_attack_detected = any(result.prompt_attack_detected for result in completed_results)
    flagged_categories = sorted(
        {category for result in completed_results for category in result.flagged_categories}
    )
    moderation_duration_ms = round((perf_counter() - started_at) * 1_000, 2)

    logger.info(
        json.dumps(
            {
                "event": "large_context_text_moderation",
                "content_source": content_source,
                "original_length": text_len,
                "num_chunks": len(completed_results),
                "parallelism": worker_count,
                "max_severity": global_max_severity,
                "prompt_attack_detected": prompt_attack_detected,
                "decision": global_decision,
                "moderation_duration_ms": moderation_duration_ms,
            }
        )
    )

    return TextLargeContextResponse(
        original_length=text_len,
        chunk_size=chunk_size,
        overlap=overlap,
        num_chunks=len(completed_results),
        chunks=completed_results,
        aggregated_decision=global_decision,
        max_severity=global_max_severity,
        flagged_categories=flagged_categories,
        content_source=content_source,
        prompt_shield_enabled=prompt_shield and content_source != "model_completion",
        prompt_attack_detected=prompt_attack_detected,
        parallelism=worker_count,
        moderation_duration_ms=moderation_duration_ms,
        processed_at_utc=datetime.now(timezone.utc).isoformat()
    )


@large_context_router.post(
    "/compress-image",
    response_model=ImageLargeContextResponse,
    summary="Compress and resize a large image, then analyze with Content Safety"
)
async def compress_image(
    file: UploadFile = File(...),
    max_dimension: int = Form(2048),
    compression_quality: int = Form(80)
):
    started_at = perf_counter()
    deadline = started_at + MAX_MODERATION_DURATION_SECONDS
    if max_dimension < IMAGE_ANALYSIS_MIN_DIMENSION or max_dimension > IMAGE_MAX_DIMENSION:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Max dimension must be between {IMAGE_ANALYSIS_MIN_DIMENSION} "
                f"and {IMAGE_MAX_DIMENSION} pixels."
            ),
        )
    if compression_quality < IMAGE_MIN_QUALITY or compression_quality > 95:
        raise HTTPException(
            status_code=400,
            detail=f"Compression quality must be between {IMAGE_MIN_QUALITY} and 95.",
        )

    if file.size is not None and file.size > MAX_IMAGE_UPLOAD_BYTES:
        await file.close()
        raise HTTPException(
            status_code=413,
            detail=f"Uploaded image exceeds the {MAX_IMAGE_UPLOAD_BYTES // (1024 * 1024)} MB source limit.",
        )

    try:
        await asyncio.wait_for(_image_job_limiter.acquire(), timeout=IMAGE_QUEUE_TIMEOUT_SECONDS)
    except TimeoutError as exc:
        await file.close()
        raise HTTPException(status_code=503, detail="Image moderation capacity is busy. Retry shortly.") from exc

    try:
        try:
            contents = await file.read(MAX_IMAGE_UPLOAD_BYTES + 1)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Could not read uploaded file.") from exc
        finally:
            await file.close()

        orig_size_bytes = len(contents)
        if orig_size_bytes == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
        if orig_size_bytes > MAX_IMAGE_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Uploaded image exceeds the {MAX_IMAGE_UPLOAD_BYTES // (1024 * 1024)} MB source limit.",
            )

        return await asyncio.to_thread(
            _normalize_and_analyze_image,
            contents,
            max_dimension,
            compression_quality,
            started_at,
            deadline,
        )
    finally:
        _image_job_limiter.release()


def _normalize_and_analyze_image(
    contents: bytes,
    max_dimension: int,
    compression_quality: int,
    started_at: float,
    deadline: float | None = None,
) -> ImageLargeContextResponse:
    """Normalize and moderate an image on a worker thread."""
    try:
        with Image.open(io.BytesIO(contents)) as source_image:
            source_w, source_h = source_image.size
            orig_format = source_image.format or "UNKNOWN"
            if source_w * source_h > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    status_code=413,
                    detail=f"Decoded image exceeds the configured {MAX_IMAGE_PIXELS:,}-pixel limit.",
                )
            img = ImageOps.exif_transpose(source_image).copy()
            img.load()
            orig_w, orig_h = img.size
    except HTTPException:
        raise
    except (Image.DecompressionBombError, OSError, ValueError) as exc:
        logger.warning("Rejected invalid image upload: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid or unsupported image.") from exc

    if img.mode != "RGB":
        img = img.convert("RGB")

    resized = False
    new_w, new_h = orig_w, orig_h
    if max(orig_w, orig_h) > max_dimension:
        img.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
        new_w, new_h = img.size
        resized = True

    if new_w < IMAGE_MIN_DIMENSION or new_h < IMAGE_MIN_DIMENSION:
        padded_w = max(new_w, IMAGE_MIN_DIMENSION)
        padded_h = max(new_h, IMAGE_MIN_DIMENSION)
        padded = Image.new("RGB", (padded_w, padded_h), "white")
        padded.paste(img, ((padded_w - new_w) // 2, (padded_h - new_h) // 2))
        img = padded
        new_w, new_h = img.size
        resized = True

    out_io = io.BytesIO()
    img.save(out_io, format="JPEG", quality=compression_quality, optimize=True)
    compressed_bytes = out_io.getvalue()
    comp_size_bytes = len(compressed_bytes)

    quality = compression_quality
    while comp_size_bytes > IMAGE_MAX_BYTES and quality > IMAGE_MIN_QUALITY:
        quality = max(IMAGE_MIN_QUALITY, quality - 10)
        out_io = io.BytesIO()
        img.save(out_io, format="JPEG", quality=quality, optimize=True)
        compressed_bytes = out_io.getvalue()
        comp_size_bytes = len(compressed_bytes)

    while comp_size_bytes > IMAGE_MAX_BYTES and max(img.size) > IMAGE_MIN_DIMENSION:
        scaled_w = max(IMAGE_MIN_DIMENSION, int(img.width * 0.85))
        scaled_h = max(IMAGE_MIN_DIMENSION, int(img.height * 0.85))
        if (scaled_w, scaled_h) == img.size:
            break
        img = img.resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)
        new_w, new_h = img.size
        resized = True
        out_io = io.BytesIO()
        img.save(out_io, format="JPEG", quality=quality, optimize=True)
        compressed_bytes = out_io.getvalue()
        comp_size_bytes = len(compressed_bytes)

    if comp_size_bytes > IMAGE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image could not be normalized below the 4 MB limit.")

    orig_size_bytes = len(contents)
    reduction = round((1 - (comp_size_bytes / orig_size_bytes)) * 100, 2)

    if deadline is not None and perf_counter() >= deadline:
        raise HTTPException(status_code=504, detail="Content Safety moderation deadline exceeded.")
    cs_res = _call_content_safety_image(compressed_bytes, deadline)
    max_severity, flagged_categories, _blocklist_matches, blocked = _analysis_decision(cs_res)
    decision = "blocked" if blocked else "safe"
    moderation_duration_ms = round((perf_counter() - started_at) * 1_000, 2)

    metrics = ImageCompressionMetrics(
        original_size_bytes=orig_size_bytes,
        original_dimensions=f"{orig_w}x{orig_h}",
        original_format=orig_format,
        compressed_size_bytes=comp_size_bytes,
        compressed_dimensions=f"{new_w}x{new_h}",
        compressed_format="JPEG",
        resized=resized,
        final_quality=quality,
        reduction_percentage=reduction
    )

    result = ImageLargeContextResponse(
        metrics=metrics,
        max_severity=max_severity,
        decision=decision,
        flagged_categories=flagged_categories,
        ocr_enabled=True,
        ocr_character_limit=1_000,
        moderation_duration_ms=moderation_duration_ms,
        processed_at_utc=datetime.now(timezone.utc).isoformat()
    )

    logger.info(
        json.dumps(
            {
                "event": "large_context_image_moderation",
                "original_size_bytes": orig_size_bytes,
                "compressed_size_bytes": comp_size_bytes,
                "original_dimensions": f"{orig_w}x{orig_h}",
                "compressed_dimensions": f"{new_w}x{new_h}",
                "max_severity": max_severity,
                "decision": decision,
                "moderation_duration_ms": moderation_duration_ms,
            }
        )
    )
    return result


@large_context_router.get(
    "/apim-config",
    summary="Get recommended APIM XML Policies and mitigation guides"
)
def get_apim_config():
    """Returns architectural documentation and standard XML policy examples for managing Large Content Concerns."""
    
    xml_size_limit = """<policies>
    <inbound>
        <base />
        <!-- Restrict request size to 4MB at the APIM level before sending to Azure AI Content Safety -->
        <validate-content max-size="4194304" size-exceeded-action="prevent" />
    </inbound>
</policies>"""

    xml_rate_limiting = """<policies>
    <inbound>
        <base />
        <!-- Limit safe text/image analysis to 100 calls per minute per subscription key -->
        <rate-limit-by-key calls="100" renewal-period="60" counter-key="@(context.Subscription.Id)" />
    </inbound>
</policies>"""

    xml_caching = """<policies>
    <inbound>
        <base />
        <!-- Cache content safety outcomes based on request body hashes (for static/re-submitted assets) -->
        <cache-lookup vary-by-developer="false" vary-by-developer-groups="false" downstream-caching-type="none">
            <vary-by-header>Content-Type</vary-by-header>
            <vary-by-query-parameter>api-version</vary-by-query-parameter>
        </cache-lookup>
    </inbound>
    <outbound>
        <base />
        <cache-store duration="3600" />
    </outbound>
</policies>"""

    xml_load_balancing = """<policies>
    <inbound>
        <base />
        <!-- Distribute request volume across multiple Content Safety instances (East US, West US, North Europe) -->
        <set-backend-service id="lb-backend" backend-id="@(new Random().Next(0, 3) == 0 ? "cs-eastus" : (new Random().Next(0, 2) == 0 ? "cs-westus" : "cs-northeurope"))" />
    </inbound>
</policies>"""

    xml_llm_content_safety = """<policies>
    <inbound>
        <base />
        <llm-content-safety backend-id="content-safety-backend"
                            shield-prompt="true"
                            enforce-on-completions="true"
                            window-size="1000"
                            window-overlap-size="200">
            <categories output-type="FourSeverityLevels">
                <category name="Hate" threshold="4" />
                <category name="SelfHarm" threshold="4" />
                <category name="Sexual" threshold="4" />
                <category name="Violence" threshold="4" />
            </categories>
        </llm-content-safety>
    </inbound>
</policies>"""

    return {
        "recommendations": [
            {
                "concern": "Harmful prompts, prompt attacks, and unsafe model completions",
                "mitigation": "Apply llm-content-safety with Prompt Shields, category thresholds, overlapping response windows, and completion enforcement. Pre-chunk requests above 10,000 characters before they reach this policy.",
                "policy_name": "LLM Content Safety",
                "policy_key": "llm_content_safety"
            },
            {
                "concern": "Image size exceeding 4MB limits",
                "mitigation": "Configure APIM Request Size Validation policy to shield Azure AI Content Safety backends, preventing oversized payloads from causing resource exhaustion and backend failures.",
                "policy_name": "Request Size Validation",
                "policy_key": "size_limit"
            },
            {
                "concern": "Rate limit exhaustion (429 Too Many Requests)",
                "mitigation": "Use Rate-Limiting-by-Key policies in APIM to guarantee fair use. Implement standard back-off retry logic in client apps and APIM retry rules.",
                "policy_name": "Rate Limiting & Quotas",
                "policy_key": "rate_limiting"
            },
            {
                "concern": "High volume / duplicate requests causing excessive billing",
                "mitigation": "Deploy APIM Caching policy with custom caching keys (e.g. image checksums or text request body hashes) to cache analysis decisions for repetitive content, saving costs and drastically reducing response times.",
                "policy_name": "Response Caching",
                "policy_key": "caching"
            },
            {
                "concern": "Regional service downtime / Single Point of Failure",
                "mitigation": "Create a multi-region deployment of Azure AI Content Safety and use APIM Backend Pool/Load-Balancing with health probes to dynamically shift traffic away from unhealthy regions.",
                "policy_name": "Backend Load-Balancing & Failover",
                "policy_key": "load_balancing"
            }
        ],
        "xml_policies": {
            "llm_content_safety": xml_llm_content_safety,
            "size_limit": xml_size_limit,
            "rate_limiting": xml_rate_limiting,
            "caching": xml_caching,
            "load_balancing": xml_load_balancing
        }
    }
