# Large-Scale Prompt Content Safety

This document defines the implemented pattern for moderating large prompts, retrieved documents, model completions, and images with Azure AI Content Safety and Azure API Management (APIM). It applies equally to Claude and other model backends.

## Supported Limits

These are service limits, not adjustable quotas:

| Feature | Limit | Implemented handling |
|---|---:|---|
| Analyze text | 10,000 characters per call | Semantic windows, overlap, bounded parallel fan-out, highest-severity aggregation |
| Prompt Shields | 10,000-character prompt; up to five documents totaling 10,000 characters | One prompt or document window per call; attack findings participate in the aggregate decision |
| Analyze image | 4 MB; dimensions from 50x50 through 7200x7200 | EXIF normalization, RGB conversion, resize, padding, adaptive JPEG compression |
| Multimodal OCR | Up to 1,000 recognized characters | `imageWithText:analyze` with `enableOcr: true`; use Azure Vision OCR plus text windowing when complete extraction is required |

## Decision Pattern

1. Classify input as `user_prompt`, `retrieved_document`, or `model_completion`.
2. Split text at nearby paragraph, line, sentence, or word boundaries. Keep windows between 100 and 10,000 characters.
3. Retain a configurable character overlap so content crossing a boundary appears in at least one complete window.
4. Analyze windows concurrently with a bounded worker count and one shared request deadline.
5. Run Prompt Shields on user prompts and retrieved-document windows. Prompt Shields is not applied to model completions.
6. Block a window when a configured category threshold, configured Content Safety blocklist, or prompt attack matches.
7. Aggregate the overall result using the highest severity and a fail-if-any-window-is-blocked rule.
8. Record content type, window count, concurrency, decision, attack status, and moderation duration without logging the complete prompt.

## Concern Resolution

| # | Concern | Resolution | Status |
|---|---|---|---|
| 1 | Input above 10,000 characters | Pre-window in the application before calling Content Safety or an APIM-protected model route. APIM's request window is fixed at 10,000 characters; the policy does not remove the underlying service limit. | Implemented in `POST /api/large-context/analyze-text` |
| 2 | Harmful intent split across boundaries | Semantic boundary selection plus overlap, highest-severity aggregation, and Prompt Shields for direct and indirect attacks. | Implemented and tested |
| 3 | Full-context moderation in one call | Not supported. Window, shield, aggregate, then enforce. Preserve the original content separately for the authorized model call after moderation succeeds. | Documented constraint |
| 4 | Image above 4 MB or outside supported dimensions | Produce a compliant JPEG derivative. Quality is reduced first, then dimensions are reduced until the derivative is at most 4 MB. Inputs below 50 pixels are padded. | Implemented in `POST /api/large-context/compress-image` |
| 5 | Text rendered in an image | Use Content Safety multimodal analysis with OCR enabled. This covers up to 1,000 recognized characters; route images requiring complete OCR through Azure Vision and the text-window endpoint. | Implemented with explicit limit |
| 6 | Consistent controls for Claude | Put category thresholds, blocklists, Prompt Shields, completion enforcement, and auditing at APIM or in the model-neutral application wrapper. Microsoft recommends configuring content safety during Claude inference because Foundry does not provide built-in deployment-time filtering for Claude. | APIM policy returned by `GET /api/large-context/apim-config` |
| 7 | Latency and user experience | Scan windows concurrently, cap concurrency with `MAX_PARALLEL_SCANS`, expose total and per-window moderation time, and use APIM completion windows for model output. | Implemented and tested |

## API Contract

`POST /api/large-context/analyze-text` accepts form fields:

| Field | Default | Notes |
|---|---|---|
| `text` | Required | Maximum aggregate request length defaults to 1,000,000 characters; window and call budgets can reject a smaller request |
| `chunk_size` | `8000` | Range: 100 through 10,000 |
| `overlap` | `1000` | Must be nonnegative and no more than half of `chunk_size` |
| `content_source` | `user_prompt` | `user_prompt`, `retrieved_document`, or `model_completion` |
| `prompt_shield` | `true` | Ignored for model completions |
| `user_prompt` | Empty | Optional associated prompt for retrieved-document attack detection |

The response includes ordered window results, category and blocklist matches, Prompt Shields results, effective parallelism, and moderation timing.

`POST /api/large-context/compress-image` accepts source images up to 32 MB and 40 million decoded pixels by default. Caller-selected maximum dimensions cannot be below 1,024 pixels, and initial JPEG quality cannot be below 60%. Two image jobs run concurrently by default; excess work receives a retryable `503` rather than accumulating decoded images in memory. It returns normalization metrics, the OCR-aware safety decision, flagged categories, and moderation timing. The caller remains responsible for forwarding the original image to the model only after the derivative passes policy.

## Runtime Configuration

| Setting | Default | Purpose |
|---|---:|---|
| `CONTENT_SAFETY_ENDPOINT` | Required | Azure AI Content Safety endpoint |
| `CONTENT_SAFETY_API_VERSION` | `2024-09-01` | Text and Prompt Shields API version |
| `CONTENT_SAFETY_MULTIMODAL_API_VERSION` | `2024-09-15-preview` | OCR-aware multimodal API version |
| `MAX_PARALLEL_SCANS` | `4` | Bounded text scan fan-out, clamped to 1-16 |
| `MAX_LARGE_TEXT_CHARS` | `1000000` | Application request-size guardrail |
| `MAX_TEXT_WINDOWS` | `64` | Maximum windows allocated by one request |
| `MAX_CONTENT_SAFETY_CALLS` | `128` | Maximum moderation plus Prompt Shields calls per request |
| `MAX_IMAGE_UPLOAD_BYTES` | `33554432` | Maximum source upload size before decode |
| `MAX_IMAGE_PIXELS` | `40000000` | Maximum decoded source pixels |
| `MAX_CONCURRENT_IMAGE_JOBS` | `2` | Process-wide image normalization and moderation concurrency |
| `IMAGE_QUEUE_TIMEOUT_SECONDS` | `2` | Time to wait for image capacity before returning `503` |
| `CONTENT_SAFETY_RETRY_ATTEMPTS` | `3` | Bounded retries for 429, transient 5xx, and network failures |
| `MAX_MODERATION_DURATION_SECONDS` | `45` | Shared deadline across all calls and retries, capped below the UI timeout |
| `CONTENT_SAFETY_BLOCKLISTS` | Empty | Comma-separated Content Safety blocklist names |
| `HATE_SEVERITY_THRESHOLD` | `SEVERITY_THRESHOLD` | Per-category block threshold |
| `SELF_HARM_SEVERITY_THRESHOLD` | `SEVERITY_THRESHOLD` | Per-category block threshold |
| `SEXUAL_SEVERITY_THRESHOLD` | `SEVERITY_THRESHOLD` | Per-category block threshold |
| `VIOLENCE_SEVERITY_THRESHOLD` | `SEVERITY_THRESHOLD` | Per-category block threshold |
| `CONTENT_SAFETY_MOCK_MODE` | `false` | Explicit local demo mode; production failures otherwise fail closed |

## APIM Enforcement

The `/apim-config` endpoint returns an `llm-content-safety` policy with:

- `shield-prompt="true"`
- `enforce-on-completions="true"`
- 1,000-character completion windows with 200-character overlap
- thresholds for Hate, SelfHarm, Sexual, and Violence

APIM must reference a Content Safety backend authenticated with APIM managed identity. Grant that identity the `Cognitive Services User` role. Add organization blocklist IDs under the policy's `<blocklists>` element when those blocklists exist in the target Content Safety resource.

## Verification

Run:

```powershell
python -m unittest tests.test_large_context_routes -v
npm --prefix ui run build
```

The tests verify bearer authentication, strict four-level response schema enforcement, semantic overlap, parallel execution, prompt-attack aggregation, shared deadlines, window and call budgets, multimodal OCR request shape, upload, decoded-pixel and image-capacity limits, image dimension normalization, and APIM policy settings.

## References

- [Azure AI Content Safety service limits](https://learn.microsoft.com/azure/ai-services/content-safety/overview#service-limits)
- [Prompt Shields quickstart](https://learn.microsoft.com/azure/ai-services/content-safety/quickstart-jailbreak)
- [Multimodal analysis with OCR](https://learn.microsoft.com/azure/ai-services/content-safety/quickstart-multimodal)
- [APIM llm-content-safety policy](https://learn.microsoft.com/azure/api-management/llm-content-safety-policy)
- [Claude models responsible AI considerations](https://learn.microsoft.com/azure/foundry/foundry-models/concepts/claude-models#responsible-ai-considerations)
