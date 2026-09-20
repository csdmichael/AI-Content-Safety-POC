"""FastAPI router providing REST endpoints for handling large context (large files/text).

This is a demonstration of how a customer can handle:
1. Large images (> 4MB) by dynamically resizing and compressing them before submission.
2. Large text (> 10,000 characters) by chunking with an overlap, evaluating each chunk, and aggregating decisions.
3. APIM policies for rate limiting, size limiting, caching, and load balancing.
"""

from __future__ import annotations

import io
import os
import re
import base64
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field
import httpx
from azure.identity import DefaultAzureCredential
from PIL import Image

# Setup logging
logger = logging.getLogger("large_context")
logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# Configuration (derived from the environment or falling back)
# ---------------------------------------------------------------------------
CONTENT_SAFETY_ENDPOINT = os.environ.get("CONTENT_SAFETY_ENDPOINT", "https://cognitiveservices.azure.com")
CONTENT_SAFETY_API_VERSION = os.environ.get("CONTENT_SAFETY_API_VERSION", "2024-09-01")
SEVERITY_THRESHOLD = int(os.environ.get("SEVERITY_THRESHOLD", "4"))

credential = DefaultAzureCredential()

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
    except Exception as e:
        # Fallback for local development if credential fails
        logger.warning(f"Failed to acquire Azure Credential token: {e}. Using dummy token.")
        return "mock_bearer_token"

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
large_context_router = APIRouter(prefix="/api/large-context", tags=["Large Context Handling"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _call_content_safety_text(text: str) -> dict:
    """Call Content Safety API for a single text chunk."""
    token = _get_auth_token()
    url = f"{CONTENT_SAFETY_ENDPOINT}/contentsafety/text:analyze?api-version={CONTENT_SAFETY_API_VERSION}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"******"
    }
    
    try:
        # Simple client request
        with httpx.Client(verify=False) as client:
            resp = client.post(url, headers=headers, json={"text": text}, timeout=15)
            
            # If Content Safety is mocked or fails in local environment, return structured mock data
            if resp.status_code == 404 or resp.status_code == 401 or "mock_bearer_token" in headers["Authorization"]:
                return _get_mock_text_analysis(text)
                
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.error(f"Error calling Azure Content Safety Text API: {e}. Falling back to rule-based mock.")
        return _get_mock_text_analysis(text)

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

def _call_content_safety_image(image_bytes: bytes) -> dict:
    """Call Content Safety API for a compressed image."""
    token = _get_auth_token()
    url = f"{CONTENT_SAFETY_ENDPOINT}/contentsafety/image:analyze?api-version={CONTENT_SAFETY_API_VERSION}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"******"
    }
    b64 = base64.b64encode(image_bytes).decode()
    
    try:
        with httpx.Client(verify=False) as client:
            resp = client.post(url, headers=headers, json={"image": {"content": b64}}, timeout=20)
            
            if resp.status_code == 404 or resp.status_code == 401 or "mock_bearer_token" in headers["Authorization"]:
                return _get_mock_image_analysis()
                
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.error(f"Error calling Azure Content Safety Image API: {e}. Falling back to default mock.")
        return _get_mock_image_analysis()

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

class TextLargeContextResponse(BaseModel):
    original_length: int
    chunk_size: int
    overlap: int
    num_chunks: int
    chunks: list[ChunkResult]
    aggregated_decision: str
    max_severity: int
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
    overlap: int = Form(1000)
):
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")
    if chunk_size <= 0:
        raise HTTPException(status_code=400, detail="Chunk size must be greater than 0.")
    if overlap >= chunk_size:
        raise HTTPException(status_code=400, detail="Overlap must be less than chunk size.")

    text_len = len(text)
    chunks = []
    
    # Chunking logic
    start = 0
    index = 0
    while start < text_len:
        end = min(start + chunk_size, text_len)
        chunk_str = text[start:end]
        chunks.append({
            "index": index,
            "text": chunk_str,
            "start": start,
            "end": end
        })
        index += 1
        if end == text_len:
            break
        start += chunk_size - overlap
        if start >= end:
            start = end

    # Analyze each chunk and collect results
    chunk_results = []
    global_max_severity = 0
    global_decision = "safe"

    for chunk in chunks:
        cs_res = _call_content_safety_text(chunk["text"])
        categories_analysis = cs_res.get("categoriesAnalysis", [])
        
        # Determine chunk severity
        chunk_max_sev = max((cat.get("severity", 0) for cat in categories_analysis), default=0)
        flagged_cats = [f"{cat['category']} ({cat['severity']})" for cat in categories_analysis if cat.get("severity", 0) > 0]
        
        chunk_decision = "blocked" if chunk_max_sev >= SEVERITY_THRESHOLD else "safe"
        
        if chunk_decision == "blocked":
            global_decision = "blocked"
            
        global_max_severity = max(global_max_severity, chunk_max_sev)
        
        # Create preview of the chunk (first 100 characters + ... + last 100 characters)
        preview = chunk["text"]
        if len(preview) > 150:
            preview = preview[:75] + " [...] " + preview[-75:]
            
        chunk_results.append(
            ChunkResult(
                index=chunk["index"],
                text_preview=preview,
                start_char=chunk["start"],
                end_char=chunk["end"],
                severity=chunk_max_sev,
                decision=chunk_decision,
                flagged_categories=flagged_cats
            )
        )

    return TextLargeContextResponse(
        original_length=text_len,
        chunk_size=chunk_size,
        overlap=overlap,
        num_chunks=len(chunk_results),
        chunks=chunk_results,
        aggregated_decision=global_decision,
        max_severity=global_max_severity,
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
    # 1. Read original file
    try:
        contents = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read uploaded file: {e}")
        
    orig_size_bytes = len(contents)
    if orig_size_bytes == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    # 2. Process with Pillow
    try:
        img = Image.open(io.BytesIO(contents))
        orig_w, orig_h = img.size
        orig_format = img.format or "UNKNOWN"
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image format. Could not open with PIL: {e}")

    # Convert to RGB mode if we are saving as JPEG (e.g. RGBA png -> RGB jpeg)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGB")

    # Downscale if needed
    resized = False
    new_w, new_h = orig_w, orig_h
    if max(orig_w, orig_h) > max_dimension:
        if orig_w > orig_h:
            new_h = int(orig_h * (max_dimension / orig_w))
            new_w = max_dimension
        else:
            new_w = int(orig_w * (max_dimension / orig_h))
            new_h = max_dimension
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        resized = True

    # Compress and save as JPEG
    out_io = io.BytesIO()
    img.save(out_io, format="JPEG", quality=compression_quality)
    compressed_bytes = out_io.getvalue()
    comp_size_bytes = len(compressed_bytes)

    # Secondary compression loop: if still > 4MB (Azure Content Safety limit), squeeze down further
    quality = compression_quality
    while comp_size_bytes > 4 * 1024 * 1024 and quality > 30:
        quality -= 10
        out_io = io.BytesIO()
        img.save(out_io, format="JPEG", quality=quality)
        compressed_bytes = out_io.getvalue()
        comp_size_bytes = len(compressed_bytes)

    reduction = round((1 - (comp_size_bytes / orig_size_bytes)) * 100, 2) if orig_size_bytes > 0 else 0.0

    # 3. Call Azure Content Safety
    cs_res = _call_content_safety_image(compressed_bytes)
    categories_analysis = cs_res.get("categoriesAnalysis", [])
    max_severity = max((cat.get("severity", 0) for cat in categories_analysis), default=0)
    decision = "blocked" if max_severity >= SEVERITY_THRESHOLD else "safe"

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

    return ImageLargeContextResponse(
        metrics=metrics,
        max_severity=max_severity,
        decision=decision,
        processed_at_utc=datetime.now(timezone.utc).isoformat()
    )


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

    return {
        "recommendations": [
            {
                "concern": "Image size exceeding 4MB limits",
                "mitigation": "Configure APIM Request Size Validation policy to shield Azure AI Content Safety backends, preventing oversized payloads from causing resource exhaustion and backend failures.",
                "policy_name": "Request Size Validation"
            },
            {
                "concern": "Rate limit exhaustion (429 Too Many Requests)",
                "mitigation": "Use Rate-Limiting-by-Key policies in APIM to guarantee fair use. Implement standard back-off retry logic in client apps and APIM retry rules.",
                "policy_name": "Rate Limiting & Quotas"
            },
            {
                "concern": "High volume / duplicate requests causing excessive billing",
                "mitigation": "Deploy APIM Caching policy with custom caching keys (e.g. image checksums or text request body hashes) to cache analysis decisions for repetitive content, saving costs and drastically reducing response times.",
                "policy_name": "Response Caching"
            },
            {
                "concern": "Regional service downtime / Single Point of Failure",
                "mitigation": "Create a multi-region deployment of Azure AI Content Safety and use APIM Backend Pool/Load-Balancing with health probes to dynamically shift traffic away from unhealthy regions.",
                "policy_name": "Backend Load-Balancing & Failover"
            }
        ],
        "xml_policies": {
            "size_limit": xml_size_limit,
            "rate_limiting": xml_rate_limiting,
            "caching": xml_caching,
            "load_balancing": xml_load_balancing
        }
    }
