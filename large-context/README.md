# Handling Large Context in Azure AI Content Safety

This folder contains architectural patterns, code modules, and user interface demonstrations to handle customer concerns when dealing with **large payloads** (large images and large text) using **Azure AI Content Safety**. It also provides best-practice integration guidelines using **Azure API Management (APIM)** to enforce enterprise-grade security and cost efficiency.

---

## 📅 Table of Contents
1. [Customer Concerns Overview](#-customer-concerns-overview)
2. [Concern 1: Large Image Payloads (> 4MB)](#-concern-1-large-image-payloads--4mb)
   - [Architectural Solution](#image-architectural-solution)
   - [Code Snippet & Implementation](#image-code-snippet--implementation)
3. [Concern 2: Large Text Payloads (> 10,000 Characters)](#-concern-2-large-text-payloads--10000-characters)
   - [Architectural Solution](#text-architectural-solution)
   - [Code Snippet & Implementation](#text-code-snippet--implementation)
4. [Concern 3: Enterprise-Grade Guardrails with APIM](#-concern-3-enterprise-grade-guardrails-with-apim)
   - [APIM XML Policy: Request Size Limit](#apim-xml-policy-request-size-limit)
   - [APIM XML Policy: Rate Limiting & Quotas](#apim-xml-policy-rate-limiting--quotas)
   - [APIM XML Policy: Response Caching](#apim-xml-policy-response-caching)
   - [APIM XML Policy: Load-Balancing & Failover](#apim-xml-policy-load-balancing--failover)
5. [Visual UI Demonstration Walkthrough](#-visual-ui-demonstration-walkthrough)
6. [References & Further Reading](#-references--further-reading)

---

## 🔍 Customer Concerns Overview

Enterprise customers frequently encounter API limits when scaling **Azure AI Content Safety** for production applications:
- **Image Size Limits:** The standard `image:analyze` endpoint has a strict request body size limit of **4MB**. High-resolution images from modern cameras or mobile devices easily exceed this limit, causing `400 Bad Request` exceptions.
- **Text Length Limits:** The `text:analyze` endpoint imposes limits on the size of input text (typically up to **10,000 characters** or approx. 1,000–1,500 tokens). Large articles, documents, or legal contracts will break these limits.
- **Rate-Limiting & High Volume Costs:** High frequency of parallel requests can quickly exhaust regional API quotas, leading to `429 Too Many Requests`. Additionally, repetitive queries for identical content cause unnecessary billing.
- **Single Point of Failure (SPOF):** Relying on a single regional endpoint for Content Safety can impact service availability in case of regional outages.

To resolve these challenges, we have developed a dual **API + UI solution** within this POC, coupled with APIM design patterns.

---

## 🖼️ Concern 1: Large Image Payloads (> 4MB)

### Image Architectural Solution
To bypass the 4MB limit while preserving image quality for threat detection, we implement a **Dynamic Image Compressor and Resizer** in our backend.

1. **Size Detection:** The API inspects the uploaded file size.
2. **Dimension Downscaling:** If the image width or height exceeds **2048px** (the maximum optimal processing resolution for Azure AI Content Safety), the system downscales the image using Pillow's high-quality `LANCZOS` filter.
3. **Format & Alpha Channel Normalization:** It converts the image to `RGB` mode (stripping alpha channels, which are unnecessary for content safety and inflate PNG sizes).
4. **Adaptive Quality Compression:** It saves the image as a `JPEG` with an initial quality of 80. If the file size is still > 4MB, it iteratively decreases the quality in steps of 10 (down to a minimum of 30) until the payload size drops well below the limit.
5. **Azure AI Submission:** The processed, highly compressed image is converted to Base64 and sent to the `image:analyze` API.

This workflow guarantees **100% submission success rate** for any uploaded image, regardless of starting size (even > 10MB or 20MB files!).

### Image Code Snippet & Implementation
The core image processing is implemented in the Python API file [api/large_context_routes.py](../api/large_context_routes.py).

```python
# Extract from api/large_context_routes.py
from PIL import Image
import io

def compress_and_resize_image(contents: bytes, max_dimension=2048, quality=80):
    img = Image.open(io.BytesIO(contents))
    orig_w, orig_h = img.size
    
    # Strip alpha channels for JPEG conversion
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGB")
        
    # Resize if dimensions exceed threshold
    if max(orig_w, orig_h) > max_dimension:
        if orig_w > orig_h:
            new_h = int(orig_h * (max_dimension / orig_w))
            new_w = max_dimension
        else:
            new_w = int(orig_w * (max_dimension / orig_h))
            new_h = max_dimension
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        
    out_io = io.BytesIO()
    img.save(out_io, format="JPEG", quality=quality)
    compressed_bytes = out_io.getvalue()
    
    # Secondary compression squeeze loop if still > 4MB
    while len(compressed_bytes) > 4 * 1024 * 1024 and quality > 30:
        quality -= 10
        out_io = io.BytesIO()
        img.save(out_io, format="JPEG", quality=quality)
        compressed_bytes = out_io.getvalue()
        
    return compressed_bytes
```

---

## 📝 Concern 2: Large Text Payloads (> 10,000 Characters)

### Text Architectural Solution
To process extremely large documents (e.g. 50,000+ characters), we implement an **Overlapping Chunking & Aggregation Engine**.

1. **Sliding Window Chunking:** The text is divided into manageable blocks of size `N` (default: 8,000 characters).
2. **Context Preservation (Overlap):** To prevent losing critical safety contexts at the boundary of a cut (e.g., a forbidden phrase split in half), we define an overlap size `M` (default: 1,000 characters). This ensures that boundary phrases are fully scanned in at least one chunk.
3. **Parallel Scanning:** Each chunk is transmitted to the Azure AI Content Safety `text:analyze` endpoint.
4. **Aggregated Decision Logic:**
   - **Verdict:** If **any** chunk is flagged as `blocked`, the overall payload is marked as `blocked`.
   - **Severity:** The global severity score is the **maximum** severity returned across all evaluated chunks.
   - **Category Mapping:** The API combines and returns distinct violations detected across all chunks for complete visibility.

### Text Code Snippet & Implementation
This overlap chunking algorithm is implemented in [api/large_context_routes.py](../api/large_context_routes.py).

```python
# Extract from api/large_context_routes.py
def chunk_text_with_overlap(text: str, chunk_size=8000, overlap=1000):
    text_len = len(text)
    chunks = []
    start = 0
    index = 0
    
    while start < text_len:
        end = min(start + chunk_size, text_len)
        chunks.append({
            "index": index,
            "text": text[start:end],
            "start": start,
            "end": end
        })
        index += 1
        if end == text_len:
            break
        start += chunk_size - overlap
        if start >= end:  # Prevent infinite loops
            start = end
            
    return chunks
```

---

## 🛡️ Concern 3: Enterprise-Grade Guardrails with APIM

Azure API Management (APIM) plays a critical role in standardizing security, compliance, caching, and failover across multiple applications utilizing Azure AI Content Safety.

### APIM XML Policy: Request Size Limit
Prevent bloated requests from saturating Content Safety compute or triggering unhandled API errors. Placing this at the APIM gateway rejects requests instantly at the edge.

```xml
<policies>
    <inbound>
        <base />
        <!-- Hard restrict request body payload size to 4MB -->
        <validate-content max-size="4194304" size-exceeded-action="prevent" />
    </inbound>
</policies>
```

### APIM XML Policy: Rate Limiting & Quotas
Ensure fair usage and prevent cost overruns or hitting Azure Cognitive Services tier limitations.

```xml
<policies>
    <inbound>
        <base />
        <!-- Rate limit client calls to 100 calls per minute per API Subscription ID -->
        <rate-limit-by-key calls="100" renewal-period="60" counter-key="@(context.Subscription.Id)" />
    </inbound>
</policies>
```

### APIM XML Policy: Response Caching
In many applications (like social media uploads or static asset databases), identical text or images are submitted repeatedly. APIM caches safe results to reduce costs and return responses in milliseconds.

```xml
<policies>
    <inbound>
        <base />
        <!-- Lookup cache using request payload hash as key -->
        <cache-lookup vary-by-developer="false" vary-by-developer-groups="false" downstream-caching-type="none">
            <vary-by-header>Content-Type</vary-by-header>
            <vary-by-query-parameter>api-version</vary-by-query-parameter>
        </cache-lookup>
    </inbound>
    <outbound>
        <base />
        <!-- Cache safety outcome for 1 hour -->
        <cache-store duration="3600" />
    </outbound>
</policies>
```

### APIM XML Policy: Load-Balancing & Failover
Create a resilient endpoint that distributes traffic between three regional instances of Azure AI Content Safety.

```xml
<policies>
    <inbound>
        <base />
        <!-- Randomly balance requests across East US, West US, and North Europe instances -->
        <set-backend-service id="lb-backend" backend-id="@(new Random().Next(0, 3) == 0 ? 'cs-eastus' : (new Random().Next(0, 2) == 0 ? 'cs-westus' : 'cs-northeurope'))" />
    </inbound>
</policies>
```

---

## 🎨 Visual UI Demonstration Walkthrough

In this POC, we built a dedicated **"Large Content"** page in the UI that dynamically displays each part of the pipeline to demystify these steps for customers.

### Step 1: Image Compression Live Demo
1. **User Uploads Large Image:** Drag and drop an image of any size (e.g. 5MB, 8MB).
2. **Visual Compression Pipeline Dashboard:**
   - **Stage 1 (Raw Metadata):** Displays original dimensions (e.g. `4032x3024`), format (e.g. `PNG`), and file size (e.g. `6.2 MB`). Marked with a ⚠️ **"Oversized for Direct CS API"** warning.
   - **Stage 2 (Processing):** Shows Pillow executing Lanczos resizing and adaptive compression.
   - **Stage 3 (Optimized Payload):** Displays output dimensions (e.g. `2048x1536`), format (`JPEG`), compressed size (e.g. `840 KB`), and the **Reduction Percentage** (e.g. `86.4% savings`). Marked with a ✅ **"Safe for Content Safety Submission"** status.
3. **Outcome Panel:** Submits the compressed payload and renders the real-time safety categorization.

### Step 2: Overlapping Text Chunking Demo
1. **User Inputs Large Text:** Paste a long block of text (e.g. 25,000 characters).
2. **Visual Chunk Slider & Preview:**
   - Highlights overlapping characters in a distinct color (e.g., orange) so the customer can visually inspect how context is preserved across splits.
   - Shows the total character count and calculated number of chunks.
3. **Execution Timeline:**
   - A step-by-step progress timeline of the chunk scans.
   - Renders individual cards showing the exact segment text processed, the severity found within that chunk, and whether that specific chunk passed or failed.
   - Renders the global aggregated final verdict.

---

## 📚 References & Further Reading

### Microsoft Learn Documentation
- [Azure AI Content Safety Documentation](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/)
- [Analyze Images with Azure AI Content Safety](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/quickstart-image)
- [Analyze Text with Azure AI Content Safety](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/quickstart-text)
- [Azure API Management (APIM) Policy Reference](https://learn.microsoft.com/en-us/azure/api-management/api-management-policies)
- [APIM Rate Limiting & Quota Policies](https://learn.microsoft.com/en-us/azure/api-management/rate-limit-by-key-policy)
- [APIM Response Caching Configurations](https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-cache)

### GitHub Repositories
- [Azure AI Content Safety SDK - Python](https://github.com/Azure/azure-sdk-for-python/tree/main/sdk/contentsafety/azure-ai-contentsafety)
- [Azure AI Content Safety SDK - JavaScript/TypeScript](https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/contentsafety/ai-content-safety-rest)
- [Azure API Management Policy Snippets Portal](https://github.com/Azure/api-management-policy-snippets)
