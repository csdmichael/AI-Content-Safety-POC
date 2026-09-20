# Large Scale Prompt Content Safety Guidelines

This document captures the key customer concerns, recommendations, and permanent fixes or workarounds for managing large-scale prompts and content safety in AI applications, particularly using Azure APIM, Content Safety, and Anthropic Claude models.

## Customer Concerns and Recommendations

| Concern # | Concern | Recommendation | Permanent Fix or Workaround |
|---|---|---|---|
| **1** | Prompt text above the 10,000 character analyze limit | Enforce Content Safety at the APIM AI gateway using the llm content safety policy. It windows the prompt automatically and scans windows in parallel, so the "Request is too large" error disappears by design. | Permanent fix. Supported product capability, configuration only. |
| **2** | Intent or jailbreak patterns split across a window boundary | Set an overlap so seam text carries into the next window, chunk on sections, paragraphs and pages rather than character counts, aggregate on highest severity, and run Prompt Shields on the user turn and retrieved documents. | Permanent fix for boundary cases. Layered controls rather than a single call. |
| **3** | Moderating the full context of a very large prompt in a single call | Not available today. The layered pattern above is the supported approach: window, shield, aggregate, then enforce. | Workaround. The 10,000 character limit is a fixed service limit, not an adjustable quota. |
| **4** | Images above 4 MB or outside 50x50 to 7200x7200 pixels | Resize, compress or tile into a compliant derivative, moderate the derivative, and forward the original image to Claude. Resolution is reduced, meaning is not. | Workaround. The 4 MB cap is a fixed service limit. |
| **5** | Text rendered inside an image | OCR the derivative and pass the extracted text through the same windowed text scan. The image classifier alone does not read embedded text. | Workaround. Application or gateway side step. |
| **6** | No DefaultV2 style native guardrails for Anthropic models | Claude in Microsoft Foundry carries Anthropic safety systems supported by Microsoft. Your enterprise policy, categories, thresholds, blocklists and audit trail live at the gateway, where they apply identically to every model behind it. | Permanent fix architecturally. Native parity for Anthropic models is a roadmap question. |
| **7** | Latency and user experience | Fan out window scans in parallel rather than serially, enforce where it pays, scan completions in windows, and instrument moderation time against model time. | Permanent fix. Design and configuration. |
